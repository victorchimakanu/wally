/**
 * Aave lending helpers that live outside the MCP subprocess.
 *
 * The WDK MCP toolkit exposes supply/borrow/quote tools, and Wally calls
 * those for anything that signs. Two things the toolkit does not expose:
 *
 * 1. The ERC-20 approve that Aave's pool needs before a supply. A one-shot
 *    runner process (approve-runner.mjs) signs it with the WDK account's own
 *    approve(); the runner gets a minimal env and exits after one signature.
 *
 * 2. The account's risk numbers (health factor, LTV, available borrows).
 *    Those are pure reads, so Wally uses the Aave protocol class with a
 *    read-only account — an address plus an RPC URL, no keys involved.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatUnits } from "ethers";
import AaveProtocolEvm from "@tetherto/wdk-protocol-lending-aave-evm";
import { WalletAccountReadOnlyEvm } from "@tetherto/wdk-wallet-evm";
import { AaveV3Arbitrum, AaveV3Ethereum } from "@bgd-labs/aave-address-book";
import { config } from "../config.js";
import { getCapturedSeed } from "./seed.js";

const execFileAsync = promisify(execFile);

const APPROVE_RUNNER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "approve-runner.mjs"
);

// Registered token addresses must match the WDK MCP toolkit's DEFAULT_TOKENS
// map — the subprocess resolves symbols against the same table.
const TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
  ethereum: {
    USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  },
  arbitrum: {
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  },
};

const POOLS: Record<string, string> = {
  ethereum: AaveV3Ethereum.POOL,
  arbitrum: AaveV3Arbitrum.POOL,
};

function rpcUrl(chain: string): string {
  return chain === "ethereum" ? config.wdkRpcEthereum : config.wdkRpcArbitrum;
}

export function tokenInfo(chain: string, symbol: string): { address: string; decimals: number } | null {
  return TOKENS[chain]?.[symbol.toUpperCase()] ?? null;
}

// toBaseUnits converts a decimal string to integer base units using string
// arithmetic, avoiding the precision loss of parseFloat * 10**decimals for
// large amounts. "12.5", 6 -> "12500000".
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = (whole + fracPadded).replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}

// approveForSupply signs the ERC-20 approve that lets Aave's pool pull the
// collateral. The MCP toolkit ships no approve tool and its sendTransaction
// carries no calldata, so this spawns a one-shot runner that calls the WDK
// account's own approve() — seed enters via env, one signature, process exits.
export async function approveForSupply(
  chain: string,
  tokenSymbol: string,
  amount: string
): Promise<string> {
  const token = tokenInfo(chain, tokenSymbol);
  const pool = POOLS[chain];
  if (!token || !pool) throw new Error(`Lending is not configured for ${tokenSymbol} on ${chain}.`);

  const baseAmount = toBaseUnits(amount, token.decimals);

  // Minimal environment: only the seed source and what Node needs to run.
  // Forwarding process.env wholesale would leak unrelated secrets into the
  // child. WDK_SEED comes from the captured holder, not process.env.
  const childEnv: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "WDK_SEED_COMMAND", "WDK_SEED_FILE"]) {
    const v = process.env[k];
    if (v) childEnv[k] = v;
  }
  const seed = getCapturedSeed();
  if (seed) childEnv["WDK_SEED"] = seed;

  const { stdout } = await execFileAsync(
    process.execPath,
    [APPROVE_RUNNER, chain, token.address, pool, baseAmount],
    { timeout: 180_000, env: childEnv }
  );

  const line = stdout.trim().split("\n").pop() ?? "";
  let parsed: { hash?: string; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error(`Approve runner returned unreadable output: ${line.slice(0, 200)}`);
  }
  if (parsed.error) throw new Error(`Approve failed: ${parsed.error}`);
  if (!parsed.hash) throw new Error("Approve runner returned no transaction hash.");
  return `Approve sent. Hash: ${parsed.hash}`;
}

export interface AccountRisk {
  totalCollateralUsd: string;
  totalDebtUsd: string;
  availableBorrowsUsd: string;
  // Health factor as a decimal string, e.g. "1.92". Below 1.0 = liquidation.
  healthFactor: string;
  liquidatable: boolean;
}

// fetchAccountRisk reads the account's Aave position with no keys involved.
export async function fetchAccountRisk(chain: string, address: string): Promise<AccountRisk> {
  const account = new WalletAccountReadOnlyEvm(address, { provider: rpcUrl(chain) });
  // Cast: the lending package nests its own copy of wdk-wallet-evm, so the
  // identical class fails nominal typing across the two installs.
  const protocol = new AaveProtocolEvm(account as unknown as ConstructorParameters<typeof AaveProtocolEvm>[0]);
  const data = await protocol.getAccountData(address);

  // Aave returns base-currency (USD) values with 8 decimals and the health
  // factor in wad (18 decimals). A health factor above ~1e10 means "no debt".
  const hfWad = data.healthFactor;
  const noDebt = data.totalDebtBase === 0n;
  const healthFactor = noDebt ? "infinite (no debt)" : Number(formatUnits(hfWad, 18)).toFixed(2);

  return {
    totalCollateralUsd: Number(formatUnits(data.totalCollateralBase, 8)).toFixed(2),
    totalDebtUsd: Number(formatUnits(data.totalDebtBase, 8)).toFixed(2),
    availableBorrowsUsd: Number(formatUnits(data.availableBorrowsBase, 8)).toFixed(2),
    healthFactor,
    liquidatable: !noDebt && Number(formatUnits(hfWad, 18)) < 1,
  };
}

// addressExplorerUrl links the wallet's page on the chain's block explorer,
// where the position's transactions are publicly visible.
export function addressExplorerUrl(chain: string, address: string): string {
  if (chain === "arbitrum") return `https://arbiscan.io/address/${address}`;
  if (chain === "ethereum") return `https://etherscan.io/address/${address}`;
  return "";
}

// describeRisk turns the numbers into the plain-English closer for the chat.
// Pass chain + address to append a block-explorer link as on-chain proof.
export function describeRisk(risk: AccountRisk, chain?: string, address?: string): string {
  const link = chain && address ? addressExplorerUrl(chain, address) : "";
  const proof = link ? `\nVerify on-chain: ${link}` : "";
  if (risk.totalDebtUsd === "0.00") {
    return `You have $${risk.totalCollateralUsd} deposited and no debt. You can borrow up to $${risk.availableBorrowsUsd}.${proof}`;
  }
  return (
    `Deposited: $${risk.totalCollateralUsd}. Borrowed: $${risk.totalDebtUsd}. ` +
    `You can still borrow up to $${risk.availableBorrowsUsd}. ` +
    `Health factor: ${risk.healthFactor} — above 1.0 is safe; at 1.0 the position can be liquidated.${proof}`
  );
}

// computeBorrowAmount does the LTV math in code — the model never invents a
// number. Both sides are priced in USD so the units cancel per token price.
export function computeBorrowAmount(
  collateralAmount: string,
  collateralPriceUsd: number,
  borrowPriceUsd: number,
  ltvPercent: number
): string {
  const collateralValue = parseFloat(collateralAmount) * collateralPriceUsd;
  const borrowValue = collateralValue * (ltvPercent / 100);
  const borrowAmount = borrowValue / borrowPriceUsd;
  // Round down to 2 decimals so we never borrow above the requested LTV.
  return (Math.floor(borrowAmount * 100) / 100).toString();
}
