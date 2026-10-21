/**
 * Transaction history, normalised across providers.
 *
 * Both Blockscout and Etherscan are mapped to the `LiveTransaction` shape the mobile app
 * already validates in `mobile/src/services/wallet-api.ts`, so switching provider is a config
 * change and the app never notices.
 *
 * Why two providers: Blockscout returns a Cloudflare 403 for Arbitrum Sepolia — to this
 * server as well as to the phone (measured 20 Oct 2026) — so it cannot be the default.
 * Etherscan V2 covers both chains through one endpoint and one key.
 */
import { config, type Chain } from "./config.js";
import { fetchJson } from "./upstream.js";
import { getLogger } from "./logger.js";

const log = getLogger("indexer");

/**
 * Explorer bases. These must match `CHAINS` in the app exactly: `parseTransaction` rejects a
 * record whose explorerUrl is not `${explorer}/tx/${hash}` character for character.
 */
const EXPLORERS: Record<Chain, string> = {
  arbitrum: "https://sepolia.arbiscan.io",
  ethereum: "https://sepolia.etherscan.io",
};

export type LiveTransaction = {
  hash: string;
  chain: Chain;
  status: "unknown" | "pending" | "confirmed" | "failed";
  explorerUrl: string;
  from?: string;
  recipient?: string;
  amount?: string;
  fee?: string;
  submittedAt?: number;
  blockNumber?: number | null;
};

/** Wei to a decimal string the app's `wei()` parser accepts. Never rounds up. */
export function formatEth(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function base(chain: Chain, hash: string): LiveTransaction {
  return { hash, chain, status: "unknown", explorerUrl: `${EXPLORERS[chain]}/tx/${hash}` };
}

// ─── Etherscan V2 ─────────────────────────────────────────────────────────────
// One host, one key; the chain is selected by `chainid`.

type EtherscanTx = Record<string, unknown>;

function fromEtherscan(chain: Chain, raw: EtherscanTx): LiveTransaction | null {
  const hash = raw["hash"];
  if (typeof hash !== "string" || !HASH.test(hash)) return null;

  const item = base(chain, hash);

  // `isError: "1"` covers reverted calls; `txreceipt_status: "0"` covers post-Byzantium
  // failures. Older records carry neither, and those are successes.
  item.status = raw["isError"] === "1" || raw["txreceipt_status"] === "0" ? "failed" : "confirmed";

  if (typeof raw["from"] === "string" && ADDRESS.test(raw["from"])) item.from = raw["from"];
  if (typeof raw["to"] === "string" && ADDRESS.test(raw["to"])) item.recipient = raw["to"];

  const value = toBigInt(raw["value"]);
  if (value !== null) item.amount = formatEth(value);

  const gasUsed = toBigInt(raw["gasUsed"]);
  const gasPrice = toBigInt(raw["gasPrice"]);
  if (gasUsed !== null && gasPrice !== null) item.fee = formatEth(gasUsed * gasPrice);

  const seconds = toBigInt(raw["timeStamp"]);
  if (seconds !== null) item.submittedAt = Number(seconds) * 1000;

  const block = toBigInt(raw["blockNumber"]);
  item.blockNumber = block === null ? null : Number(block);

  return item;
}

async function viaEtherscan(chain: Chain, address: string): Promise<LiveTransaction[]> {
  const url = new URL(config.etherscanBase);
  url.searchParams.set("chainid", String(chain === "arbitrum" ? 421614 : 11155111));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "50");
  url.searchParams.set("sort", "desc");
  if (config.etherscanApiKey) url.searchParams.set("apikey", config.etherscanApiKey);

  const body = await fetchJson<{ status?: unknown; message?: unknown; result?: unknown }>(
    url.toString(),
    {},
    `etherscan ${chain}`,
  );

  // Etherscan answers HTTP 200 for logical failures. An empty history is reported as
  // status "0" with "No transactions found" — that is success, not an error, and treating
  // it as one would make every fresh wallet look broken.
  if (body.status !== "1") {
    const message = typeof body.message === "string" ? body.message : "unknown response";
    if (/no transactions found/i.test(message)) return [];
    const detail = typeof body.result === "string" ? body.result : message;
    throw new Error(`etherscan: ${detail}`);
  }

  if (!Array.isArray(body.result)) throw new Error("etherscan: unexpected result shape");
  return body.result.map((raw) => fromEtherscan(chain, raw as EtherscanTx)).filter((tx): tx is LiveTransaction => tx !== null);
}

// ─── Blockscout ───────────────────────────────────────────────────────────────

function fromBlockscout(chain: Chain, raw: Record<string, unknown>): LiveTransaction | null {
  const hash = raw["hash"];
  if (typeof hash !== "string" || !HASH.test(hash)) return null;

  const item = base(chain, hash);
  const status = raw["status"];
  item.status = status === "ok" ? "confirmed" : status === "error" ? "failed" : "pending";

  const from = raw["from"] as { hash?: unknown } | undefined;
  const to = raw["to"] as { hash?: unknown } | undefined;
  if (typeof from?.hash === "string" && ADDRESS.test(from.hash)) item.from = from.hash;
  if (typeof to?.hash === "string" && ADDRESS.test(to.hash)) item.recipient = to.hash;

  const value = toBigInt(raw["value"]);
  if (value !== null) item.amount = formatEth(value);

  const fee = raw["fee"] as { value?: unknown } | undefined;
  const feeValue = toBigInt(fee?.value);
  if (feeValue !== null) item.fee = formatEth(feeValue);

  if (typeof raw["timestamp"] === "string") {
    const parsed = Date.parse(raw["timestamp"]);
    if (Number.isFinite(parsed)) item.submittedAt = parsed;
  }

  const block = raw["block_number"] ?? raw["block"];
  item.blockNumber = typeof block === "number" ? block : null;

  return item;
}

async function viaBlockscout(chain: Chain, address: string): Promise<LiveTransaction[]> {
  const host = chain === "arbitrum" ? config.indexerArbitrum : config.indexerEthereum;
  // No `filter`: the endpoint already returns transactions in both directions, and the only
  // accepted values are the singular "to" or "from". Asking for `filter=to | from` is a 422
  // ("Invalid value for enum") from the live service — measured 21 Oct 2026. Kojo's dev
  // server calls it without a filter for this reason; this matches it.
  const body = await fetchJson<{ items?: unknown }>(
    `${host}/api/v2/addresses/${address}/transactions`,
    {},
    `blockscout ${chain}`,
  );
  if (!Array.isArray(body.items)) return [];
  return body.items
    .slice(0, 50)
    .map((raw) => fromBlockscout(chain, raw as Record<string, unknown>))
    .filter((tx): tx is LiveTransaction => tx !== null);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchHistory(chain: Chain, address: string): Promise<{ items: LiveTransaction[]; source: string }> {
  const provider = config.indexerProvider;
  log.debug({ chain, provider }, "fetching history");
  const items = provider === "etherscan" ? await viaEtherscan(chain, address) : await viaBlockscout(chain, address);
  return { items, source: provider };
}

export const __test = { fromEtherscan, fromBlockscout, formatEth, EXPLORERS, viaBlockscout, viaEtherscan };
