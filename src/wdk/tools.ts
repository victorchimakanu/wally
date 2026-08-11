// Typed tool call functions used by the agent.
// These wrap src/wdk/client.ts with validation and friendly error messages.

// ethers is provided transitively by @tetherto/wdk-wallet-evm; used here only
// to recover the real tx hash when WDK returns raw signed transaction bytes.
import { Transaction } from "ethers";
import * as wdk from "./client.js";
import { config } from "../config.js";
import { getLogger } from "../logger.js";
import type { ChainBalance } from "../types.js";

const log = getLogger("wdk:tools");

export const BLOCK_EXPLORERS: Record<string, (hash: string) => string> = {
  ethereum: (h) => `https://etherscan.io/tx/${h}`,
  arbitrum: (h) => `https://arbiscan.io/tx/${h}`,
  tron:     (h) => `https://tronscan.org/#/transaction/${h}`,
  bitcoin:  (h) => `https://mempool.space/tx/${h}`,
};

export function explorerUrl(chain: string, txHash: string): string {
  const fn = BLOCK_EXPLORERS[chain.toLowerCase()];
  if (!fn) return "";
  return fn(txHash);
}

export async function fetchAllBalances(chains: string[]): Promise<ChainBalance[]> {
  const results: ChainBalance[] = [];
  for (const chain of chains) {
    try {
      const raw = await wdk.getBalance(chain);
      results.push({ chain, token: "native", amount: normalizeAmount(raw) });

      // Also fetch USDT on EVM chains
      if (["ethereum", "arbitrum"].includes(chain)) {
        try {
          const usdt = await wdk.getTokenBalance(chain, "USDT");
          results.push({ chain, token: "USDT", amount: normalizeAmount(usdt) });
        } catch {
          // USDT not available on this chain, skip
        }
      }
    } catch (err) {
      log.warn({ chain, err }, "Could not fetch balance for chain");
    }
  }
  return results;
}

export function nativeSymbol(chain: string): string {
  return chain.toLowerCase() === "bitcoin" ? "BTC" : "ETH";
}

// describeBalances turns a ChainBalance[] into a plain-English chat reply.
export function describeBalances(balances: ChainBalance[]): string {
  if (balances.length === 0) return "I could not fetch any balances right now. Check the connection and try again.";
  const byChain = new Map<string, string[]>();
  for (const b of balances) {
    const sym = b.token === "native" ? nativeSymbol(b.chain) : b.token;
    const list = byChain.get(b.chain) ?? [];
    list.push(`${b.amount} ${sym}`);
    byChain.set(b.chain, list);
  }
  return Array.from(byChain.entries())
    .map(([chain, list]) => `${chain.charAt(0).toUpperCase() + chain.slice(1)}: ${list.join(", ")}`)
    .join("\n");
}

export interface QuoteResult {
  fee: string;
  summary: string;
}

export async function quoteAndDescribeTransfer(
  chain: string,
  token: string,
  amount: string,
  to: string
): Promise<QuoteResult> {
  const raw = await wdk.quoteTransfer(chain, token, amount, to);
  return { fee: extractFee(raw), summary: raw };
}

export async function executeTransfer(
  chain: string,
  token: string,
  amount: string,
  to: string
): Promise<{ txHash: string; explorerUrl: string }> {
  const raw = await wdk.transfer(chain, token, amount, to);
  // Defense in depth: some toolkit versions return error text without the
  // MCP isError flag. Never let an error string become a "hash".
  if (/^\s*error/i.test(raw)) throw new Error(raw.trim());
  const hash = extractTxHash(raw);
  return { txHash: hash, explorerUrl: explorerUrl(chain, hash) };
}

export async function quoteAndDescribeSwap(
  chain: string,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<QuoteResult> {
  const raw = await wdk.quoteSwap(chain, fromToken, toToken, amount);
  return { fee: extractFee(raw), summary: raw };
}

export async function executeSwap(
  chain: string,
  fromToken: string,
  toToken: string,
  amount: string
): Promise<{ txHash: string; explorerUrl: string }> {
  const raw = await wdk.swap(chain, fromToken, toToken, amount);
  if (/^\s*error/i.test(raw)) throw new Error(raw.trim());
  const hash = extractTxHash(raw);
  return { txHash: hash, explorerUrl: explorerUrl(chain, hash) };
}

export async function fetchAddress(chain: string): Promise<string> {
  return wdk.getAddress(chain);
}

// fetchNativeBalanceNumber returns the chain's native balance as a number
// (ETH or BTC units). Used for the gas preflight before transfers.
export async function fetchNativeBalanceNumber(chain: string): Promise<number> {
  const raw = await wdk.getBalance(chain);
  const n = Number(normalizeAmount(raw).replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}

// verifyTxOnChain polls the chain's RPC for the transaction. Returns true the
// moment the node knows the hash (pending or mined), false if it never appears.
// EVM chains only; other chains return true (no verification path).
export async function verifyTxOnChain(chain: string, txHash: string): Promise<boolean> {
  const rpc =
    chain === "ethereum" ? config.wdkRpcEthereum :
    chain === "arbitrum" ? config.wdkRpcArbitrum :
    null;
  if (!rpc) return true; // no verification path for this chain
  // On a chain we CAN verify, something that is not a hash can never be found.
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return false;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionByHash",
          params: [txHash],
        }),
      });
      const json = (await res.json()) as { result?: unknown };
      if (json.result) return true;
    } catch (err) {
      log.warn({ chain, err }, "verifyTxOnChain RPC call failed");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

export async function fetchPrice(token: string): Promise<string> {
  return wdk.getPrice(token);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// WDK balance strings arrive in mixed formats: "Balance: 0 wei",
// "12.5 USDT (12500000 base units)", "0 satoshis". Normalize to a plain
// human-readable number so the UI never has to parse.
function normalizeAmount(raw: string): string {
  let str = String(raw).trim()
    .replace(/^balance:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

  const wei = str.match(/^([\d,]+(?:\.\d+)?)\s*wei$/i);
  if (wei) return formatUnits(wei[1]!, 1e18, 6);

  const sats = str.match(/^([\d,]+(?:\.\d+)?)\s*(?:satoshis?|sats?)$/i);
  if (sats) return formatUnits(sats[1]!, 1e8, 8);

  const withToken = str.match(/^([\d,]+(?:\.\d+)?)\s+[A-Za-z]+$/);
  if (withToken) return withToken[1]!;

  if (/^[\d,]+(\.\d+)?$/.test(str)) return str;

  return str;
}

function formatUnits(numStr: string, divisor: number, maxDecimals: number): string {
  const n = Number(numStr.replace(/,/g, "")) / divisor;
  if (!isFinite(n)) return "0";
  return n.toFixed(maxDecimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function extractTxHash(raw: string): string {
  // Prefer the toolkit's labeled form: "Transfer sent! Hash: 0x... Fee: ..."
  const labeled = raw.match(/hash:\s*(0x[0-9a-fA-F]+)/i);
  const candidate = labeled?.[1] ?? raw.match(/0x[0-9a-fA-F]{64,}/)?.[0];

  if (candidate) {
    if (candidate.length === 66) return candidate;
    // Longer than 32 bytes: WDK sometimes returns the raw signed transaction
    // in the hash field. Recover the real hash by decoding it.
    if (candidate.length > 66) {
      try {
        const decoded = Transaction.from(candidate);
        if (decoded.hash) {
          log.warn({ rawLength: candidate.length }, "WDK returned raw signed tx as hash — recovered real hash by decoding");
          return decoded.hash;
        }
      } catch {
        // not a decodable transaction; fall through
      }
      return candidate.slice(0, 66);
    }
  }

  // Bitcoin txid: bare 64-char hex, no 0x prefix
  const btcMatch = raw.match(/\b[0-9a-fA-F]{64}\b/);
  if (btcMatch) return btcMatch[0];
  return raw.trim();
}

function extractFee(raw: string): string {
  // Try to find fee/gas cost mentioned in the WDK response
  const match = raw.match(/fee[:\s]+([^\n,]+)/i) ?? raw.match(/gas[:\s]+([^\n,]+)/i);
  return match ? match[1]!.trim() : "see details";
}
