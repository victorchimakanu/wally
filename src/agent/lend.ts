/**
 * lend_borrow: the chained Aave flow — approve, supply, borrow — from one
 * sentence, with the LTV asked for when the user leaves it out.
 *
 * Division of labor, stated once: the model only parses the sentence into
 * slots. Every number that reaches the chain — the borrow amount, the LTV
 * cap — is computed here in code from live prices and hard limits.
 */

import * as wdk from "../wdk/client.js";
import * as tools from "../wdk/tools.js";
import { approveForSupply, fetchAccountRisk, describeRisk, computeBorrowAmount, tokenInfo } from "../wdk/lending.js";
import { MAX_LTV_PERCENT, type LendBorrowIntent } from "./intent.js";
import { getLogger } from "../logger.js";

const log = getLogger("agent:lend");

type LendParams = LendBorrowIntent["params"];

// ─── LTV slot-filling ─────────────────────────────────────────────────────────
// When the user says "put 200 USDT on Aave and borrow" without an LTV, the
// params wait here and the next message is first checked for a bare LTV
// answer ("50", "50%", "at 50 percent") before going to the model.

const PENDING_TTL_MS = 5 * 60_000;

interface PendingLend {
  params: LendParams;
  expiresAt: number;
}

const pendingLend = new Map<string, PendingLend>();

export function storePendingLend(sessionId: string, params: LendParams): void {
  pendingLend.set(sessionId, { params, expiresAt: Date.now() + PENDING_TTL_MS });
}

export function clearPendingLend(sessionId: string): void {
  pendingLend.delete(sessionId);
}

// takePendingLend returns completed params when the message answers the LTV
// question, and null otherwise (expired, no pending state, or unrelated text).
export function takePendingLend(sessionId: string, message: string): LendParams | null {
  const entry = pendingLend.get(sessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingLend.delete(sessionId);
    return null;
  }

  const m = message.match(/^\s*(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)?\s*(?:ltv)?\s*$/i);
  if (!m) return null;

  const ltv = parseFloat(m[1]!);
  if (!(ltv > 0 && ltv <= MAX_LTV_PERCENT)) return null;

  pendingLend.delete(sessionId);
  return { ...entry.params, ltv };
}

// ─── Plan building ────────────────────────────────────────────────────────────

export interface LendPlan {
  params: Required<Pick<LendParams, "chain" | "collateralToken" | "collateralAmount" | "borrowToken">> & { ltv: number };
  borrowAmount: string;
  summary: string;
}

async function priceUsd(token: string): Promise<number> {
  // Stablecoin fast path keeps the demo deterministic and offline-friendly.
  if (["USDT", "USDC", "DAI"].includes(token.toUpperCase())) return 1;
  const raw = await tools.fetchPrice(token);
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Could not price ${token} (got "${raw}").`);
  return n;
}

export async function buildLendPlan(params: LendParams): Promise<LendPlan> {
  const { chain, collateralToken, collateralAmount, borrowToken } = params;
  const ltv = params.ltv!;

  if (!tokenInfo(chain, collateralToken)) {
    throw new Error(`${collateralToken} is not set up for lending on ${chain}. USDT is supported.`);
  }
  if (!tokenInfo(chain, borrowToken)) {
    throw new Error(`${borrowToken} is not set up for borrowing on ${chain}. USDT is supported.`);
  }

  const [collateralPrice, borrowPrice] = await Promise.all([
    priceUsd(collateralToken),
    priceUsd(borrowToken),
  ]);

  const borrowAmount = computeBorrowAmount(collateralAmount, collateralPrice, borrowPrice, ltv);
  if (parseFloat(borrowAmount) <= 0) {
    throw new Error("The computed borrow amount is zero. Try a larger deposit or a higher LTV.");
  }

  const summary =
    `Plan (3 on-chain steps on ${chain}):\n` +
    `1. Approve ${collateralAmount} ${collateralToken} for the Aave pool\n` +
    `2. Deposit ${collateralAmount} ${collateralToken} as collateral\n` +
    `3. Borrow ${borrowAmount} ${borrowToken} (${ltv}% loan-to-value)\n` +
    `The borrow amount is computed from the deposit value times your LTV, capped at ${MAX_LTV_PERCENT}%.`;

  return {
    params: { chain, collateralToken, collateralAmount, borrowToken, ltv },
    borrowAmount,
    summary,
  };
}

// ─── Execution ────────────────────────────────────────────────────────────────

// waitForCollateralIncrease polls until the account's Aave collateral has
// risen by at least `minDeltaUsd` above the pre-supply baseline. Delta-based,
// not absolute: pre-existing collateral must not be mistaken for the new
// deposit having landed.
async function waitForCollateralIncrease(
  chain: string,
  address: string,
  baselineCollateralUsd: number,
  minDeltaUsd: number,
  timeoutMs = 120_000,
  intervalMs = 4_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  // Allow a small tolerance for price rounding on the USD figures.
  const target = baselineCollateralUsd + minDeltaUsd * 0.9;
  while (Date.now() < deadline) {
    try {
      const risk = await fetchAccountRisk(chain, address);
      if (parseFloat(risk.totalCollateralUsd) >= target) return true;
    } catch (err) {
      log.warn({ err }, "Collateral poll failed — retrying");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// waitForDebtIncrease polls until debt has risen by at least `minDeltaUsd`
// above the pre-borrow baseline — so a wallet that already carried debt cannot
// make a reverted borrow look successful.
async function waitForDebtIncrease(
  chain: string,
  address: string,
  baselineDebtUsd: number,
  minDeltaUsd: number,
  timeoutMs = 60_000,
  intervalMs = 3_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const target = baselineDebtUsd + minDeltaUsd * 0.9;
  while (Date.now() < deadline) {
    try {
      const risk = await fetchAccountRisk(chain, address);
      if (parseFloat(risk.totalDebtUsd) >= target) return true;
    } catch (err) {
      log.warn({ err }, "Debt poll failed — retrying");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export interface LendStepResult {
  step: string;
  detail: string;
}

// executeLendPlan runs the three steps in order, stopping at the first
// failure. onStep lets the agent stream progress into the chat.
export async function executeLendPlan(
  plan: LendPlan,
  walletAddress: string,
  onStep: (msg: string) => void
): Promise<{ steps: LendStepResult[]; riskSummary: string }> {
  const { chain, collateralToken, collateralAmount, borrowToken } = plan.params;
  const steps: LendStepResult[] = [];

  // Baseline the position BEFORE any step, so every verification below is a
  // delta against the wallet's prior state — a wallet that already holds
  // collateral/debt cannot make a reverted step look successful.
  const baseline = await fetchAccountRisk(chain, walletAddress).catch(() => null);
  const baseCollateral = baseline ? parseFloat(baseline.totalCollateralUsd) : 0;
  const baseDebt = baseline ? parseFloat(baseline.totalDebtUsd) : 0;
  const collateralValueUsd = parseFloat(collateralAmount); // USDT ~ $1
  const borrowValueUsd = parseFloat(plan.borrowAmount);

  onStep(`Step 1 of 3: approving ${collateralAmount} ${collateralToken} for the Aave pool...`);
  const approveRaw = await approveForSupply(chain, collateralToken, collateralAmount);
  if (/^\s*error/i.test(approveRaw)) throw new Error(`Approve failed: ${approveRaw.trim()}`);
  steps.push({ step: "approve", detail: approveRaw.trim() });
  log.info({ chain }, "Lend step 1/3 (approve) done");

  onStep(`Step 2 of 3: depositing ${collateralAmount} ${collateralToken} into Aave...`);
  const supplyRaw = await wdk.supply(chain, collateralToken, collateralAmount);
  if (/^\s*error|cancelled/i.test(supplyRaw)) throw new Error(`Deposit failed: ${supplyRaw.trim()}`);
  steps.push({ step: "supply", detail: supplyRaw.trim() });
  log.info({ chain }, "Lend step 2/3 (supply) done");

  // Verify the deposit actually raised collateral (delta), rather than trusting
  // the WDK string or pre-existing headroom. This also gives the user op time
  // to mine before we borrow against it.
  onStep("Waiting for the deposit to settle on-chain...");
  const supplied = await waitForCollateralIncrease(chain, walletAddress, baseCollateral, collateralValueUsd);
  if (!supplied) {
    throw new Error(
      "The deposit was sent but I could not confirm it landed in Aave within 2 minutes. " +
        "Do not assume it failed — say 'how safe is my loan' to check your position before retrying."
    );
  }

  onStep(`Step 3 of 3: borrowing ${plan.borrowAmount} ${borrowToken}...`);
  const borrowRaw = await wdk.borrow(chain, borrowToken, plan.borrowAmount);
  if (/^\s*error|cancelled/i.test(borrowRaw)) throw new Error(`Borrow failed: ${borrowRaw.trim()}`);
  steps.push({ step: "borrow", detail: borrowRaw.trim() });
  log.info({ chain }, "Lend step 3/3 (borrow) done");

  // Verify the borrow raised debt by roughly the borrowed amount (delta), so a
  // reverted borrow against pre-existing debt cannot read as success.
  const borrowed = await waitForDebtIncrease(chain, walletAddress, baseDebt, borrowValueUsd);
  if (!borrowed) {
    throw new Error(
      "The deposit went through but I could not confirm the borrow on-chain. Your collateral is safe " +
        "in Aave. Say 'how safe is my loan' to check, then try borrowing again."
    );
  }
  const risk = await fetchAccountRisk(chain, walletAddress).catch(() => null);

  const riskSummary = risk
    ? describeRisk(risk, chain, walletAddress)
    : "Done. I could not fetch the live health factor right now — say 'how safe is my loan' to retry.";

  return { steps, riskSummary };
}
