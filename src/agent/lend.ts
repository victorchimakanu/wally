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

// waitForBorrowingPower polls the account's live Aave position until the
// available borrow headroom covers the planned borrow (both sides USD).
async function waitForBorrowingPower(
  chain: string,
  address: string,
  requiredUsd: number,
  timeoutMs = 120_000,
  intervalMs = 4_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const risk = await fetchAccountRisk(chain, address);
      if (parseFloat(risk.availableBorrowsUsd) >= requiredUsd) return true;
    } catch (err) {
      log.warn({ err }, "Borrowing-power poll failed — retrying");
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

  // The deposit is submitted as a user operation and may take a few blocks to
  // mine. Borrowing before Aave sees the collateral reverts with zero
  // borrowing power, so poll the live position until it covers the borrow.
  onStep("Waiting for the deposit to settle on-chain...");
  const borrowValueUsd = parseFloat(plan.borrowAmount);
  const settled = await waitForBorrowingPower(chain, walletAddress, borrowValueUsd);
  if (!settled) {
    throw new Error(
      "The deposit was sent but has not settled after 2 minutes. Your collateral is safe in Aave. " +
        "Say 'how safe is my loan' to check, then ask me to borrow again once it settles."
    );
  }

  onStep(`Step 3 of 3: borrowing ${plan.borrowAmount} ${borrowToken}...`);
  const borrowRaw = await wdk.borrow(chain, borrowToken, plan.borrowAmount);
  if (/^\s*error|cancelled/i.test(borrowRaw)) throw new Error(`Borrow failed: ${borrowRaw.trim()}`);
  steps.push({ step: "borrow", detail: borrowRaw.trim() });
  log.info({ chain }, "Lend step 3/3 (borrow) done");

  let riskSummary = "";
  try {
    const risk = await fetchAccountRisk(chain, walletAddress);
    riskSummary = describeRisk(risk, chain, walletAddress);
  } catch (err) {
    log.warn({ err }, "Could not fetch post-trade account risk");
    riskSummary = "Done. I could not fetch the live health factor right now — say 'how safe is my loan' to retry.";
  }

  return { steps, riskSummary };
}
