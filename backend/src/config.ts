/**
 * Environment configuration. Fails fast and loudly on anything invalid, matching the
 * desktop app's behaviour in ../src/config.ts — a misconfigured money service should
 * refuse to start rather than run in a half-broken state.
 */
import { z } from "zod";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadDotenv(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path.join(root, file), "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
      }
    } catch {
      // A missing file is normal.
    }
  }
}
loadDotenv();

/** Chains the proxy will talk to. Anything not listed here is rejected at the route. */
export const CHAINS = {
  arbitrum: { id: 421614, name: "Arbitrum Sepolia" },
  ethereum: { id: 11155111, name: "Ethereum Sepolia" },
} as const;
export type Chain = keyof typeof CHAINS;
export function isChain(value: unknown): value is Chain {
  // Object.hasOwn, not `in`: `"__proto__" in CHAINS` is true and would pass validation,
  // letting an attacker-chosen key reach the lookup. Caught by test/proxy.test.ts.
  return typeof value === "string" && Object.hasOwn(CHAINS, value);
}

/**
 * JSON-RPC methods the proxy will forward. Everything else is refused.
 *
 * Read methods only by default. `eth_sendRawTransaction` is deliberately absent — see
 * `rpcAllowBroadcast` below, which is an explicit operator decision rather than a default.
 */
export const RPC_READ_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  // Required by the send path: refuses a contract recipient, where native ETH would be
  // lost. Used in both quote and confirm in the wallet flow.
  "eth_getCode",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_call",
] as const;

const Schema = z.object({
  port: z.coerce.number().int().positive().default(8080),
  // Bind loopback by default; a VPS runs this behind a reverse proxy that terminates TLS.
  host: z.string().default("127.0.0.1"),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  rpcArbitrum: z.string().url().default("https://sepolia-rollup.arbitrum.io/rpc"),
  rpcEthereum: z.string().url().default("https://ethereum-sepolia-rpc.publicnode.com"),

  indexerArbitrum: z.string().url().default("https://arbitrum-sepolia.blockscout.com"),
  indexerEthereum: z.string().url().default("https://eth-sepolia.blockscout.com"),

  /**
   * Which transaction indexer to use.
   *
   * Defaults to etherscan: Blockscout returns a Cloudflare 403 for Arbitrum Sepolia to this
   * server as well as to the phone (measured 20 Oct 2026), so it cannot serve Activity.
   * Etherscan V2 reaches both chains through one endpoint and one key.
   */
  indexerProvider: z.enum(["etherscan", "blockscout"]).default("etherscan"),
  etherscanBase: z.string().url().default("https://api.etherscan.io/v2/api"),
  etherscanApiKey: z.string().optional(),

  coingeckoBase: z.string().url().default("https://api.coingecko.com/api/v3"),
  // Optional. A demo key raises CoinGecko's rate limit; without one the public tier applies.
  coingeckoApiKey: z.string().optional(),

  /**
   * Allow the proxy to relay already-signed transactions.
   *
   * It cannot tamper with one — altering any byte invalidates the signature — so the risk is
   * abuse as an open broadcast relay, not theft. Rate limiting bounds that. Off by default so
   * turning it on is a deliberate choice.
   */
  rpcAllowBroadcast: z.string().default("false").transform((value) => value === "true"),

  /**
   * Shared key callers must present as `x-wally-key`.
   *
   * Honest about what this is: the mobile app ships it in its bundle, so it is not a secret
   * from anyone willing to unpack an APK. It stops drive-by scanners and casual quota theft,
   * which is the actual threat to a small public service. It is not user authentication, and
   * the rate limiter remains the real backstop.
   *
   * Optional on loopback so local development needs no setup. Mandatory off loopback —
   * buildConfig() refuses to start otherwise.
   */
  appKey: z.string().optional(),

  /** Requests per minute per client IP, across all routes. */
  rateLimitPerMinute: z.coerce.number().int().positive().default(120),

  /**
   * Which proxy may set `X-Forwarded-For`.
   *
   * `trustProxy: true` trusts that header from ANY client, which turns the rate limiter into
   * a no-op the moment this port is reachable without going through the reverse proxy — a
   * firewall mistake, or anyone curling the VPS address directly. Defaulting to the loopback
   * address matches the documented deployment (Caddy or nginx on the same host) and means a
   * forged header from outside is ignored.
   *
   * Accepts an IP or CIDR list, or `false` to use the socket address only. A hop count is
   * deliberately NOT accepted: GHSA-3m5p-2c4r-xxw2 is X-Forwarded-* spoofing under exactly
   * that configuration, so offering it would be handing someone a documented footgun.
   */
  trustedProxy: z.string().default("127.0.0.1"),

  /** Comma-separated origins for the web preview. Native apps send no Origin header. */
  allowedOrigins: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),

  upstreamTimeoutMs: z.coerce.number().int().positive().default(12_000),

  /**
   * Local QVAC model server. The backend fronts it because QVAC omits
   * `access-control-allow-origin` on streaming (text/event-stream) responses, so a browser
   * blocks every streamed chat reply. Native builds send no Origin and are unaffected.
   */
  qvacUrl: z.string().url().default("http://127.0.0.1:11434"),
  /** Inference is slow on CPU — measured 8-16s here — so it needs its own, longer budget. */
  qvacTimeoutMs: z.coerce.number().int().positive().default(120_000),
  marketCacheMs: z.coerce.number().int().positive().default(60_000),
  chartCacheMs: z.coerce.number().int().positive().default(300_000),
  historyCacheMs: z.coerce.number().int().positive().default(15_000),
  /**
   * Cache window for safely-cacheable RPC reads (balances above all). The app polls balances
   * every 60s per chain per user, so without this the proxy simply forwards the stampede.
   * Set to 0 to disable caching entirely.
   */
  rpcCacheMs: z.coerce.number().int().nonnegative().default(10_000),
});

/** Shared by the startup guards and by the route gating in server.ts. */
export function isLoopbackHost(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}

function build() {
  const parsed = Schema.safeParse({
    port: process.env["PORT"],
    host: process.env["HOST"],
    logLevel: process.env["LOG_LEVEL"],
    rpcArbitrum: process.env["RPC_ARBITRUM"],
    rpcEthereum: process.env["RPC_ETHEREUM"],
    indexerArbitrum: process.env["INDEXER_ARBITRUM"],
    indexerEthereum: process.env["INDEXER_ETHEREUM"],
    indexerProvider: process.env["INDEXER_PROVIDER"],
    etherscanBase: process.env["ETHERSCAN_BASE"],
    etherscanApiKey: process.env["ETHERSCAN_API_KEY"] || undefined,
    coingeckoBase: process.env["COINGECKO_BASE"],
    coingeckoApiKey: process.env["COINGECKO_API_KEY"] || undefined,
    rpcAllowBroadcast: process.env["RPC_ALLOW_BROADCAST"],
    appKey: process.env["WALLY_APP_KEY"] || undefined,
    rateLimitPerMinute: process.env["RATE_LIMIT_PER_MINUTE"],
    trustedProxy: process.env["TRUSTED_PROXY"],
    allowedOrigins: process.env["ALLOWED_ORIGINS"],
    upstreamTimeoutMs: process.env["UPSTREAM_TIMEOUT_MS"],
    qvacUrl: process.env["QVAC_URL"],
    qvacTimeoutMs: process.env["QVAC_TIMEOUT_MS"],
    marketCacheMs: process.env["MARKET_CACHE_MS"],
    chartCacheMs: process.env["CHART_CACHE_MS"],
    historyCacheMs: process.env["HISTORY_CACHE_MS"],
    rpcCacheMs: process.env["RPC_CACHE_MS"],
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    console.error("Configuration error — fix your .env and restart:\n" + issues);
    process.exit(1);
  }
  const cfg = parsed.data;

  // Binding off loopback exposes provider quota to the internet. Require a key, and refuse
  // to start without one rather than coming up quietly unprotected.
  const loopback = isLoopbackHost(cfg.host);
  if (!loopback && !cfg.appKey) {
    console.error(
      "Configuration error: HOST is not loopback, so WALLY_APP_KEY is required.\n" +
        "  Generate one with:  openssl rand -base64 32",
    );
    process.exit(1);
  }
  if (!loopback && cfg.appKey && cfg.appKey.length < 16) {
    console.error("Configuration error: WALLY_APP_KEY must be at least 16 characters.");
    process.exit(1);
  }
  if (cfg.indexerProvider === "etherscan" && !cfg.etherscanApiKey) {
    console.error(
      "Note: INDEXER_PROVIDER=etherscan but ETHERSCAN_API_KEY is unset — Activity will fail.\n" +
        "  Get a free key at https://etherscan.io/apis (one key covers both chains).",
    );
  }
  if (loopback && !cfg.appKey) {
    console.error("Note: no WALLY_APP_KEY set. Fine on loopback; required before exposing this service.");
  }

  return cfg;
}

export const config = build();

export function rpcUrl(chain: Chain): string {
  return chain === "arbitrum" ? config.rpcArbitrum : config.rpcEthereum;
}
export function indexerUrl(chain: Chain): string {
  return chain === "arbitrum" ? config.indexerArbitrum : config.indexerEthereum;
}
/**
 * Fastify's `trustProxy` in the shape it expects: false, a hop count, or an address list.
 * Anything else is passed through as a list, which is how a CIDR or several proxies are given.
 */
export function trustProxySetting(): boolean | string {
  const raw = config.trustedProxy.trim();
  if (raw === "" || raw.toLowerCase() === "false") return false;
  if (raw.toLowerCase() === "true") return true;
  // A bare number would be read by Fastify as a hop count; refuse it rather than accept a
  // configuration with a published spoofing advisory against it.
  if (/^\d+$/.test(raw)) {
    console.error(
      "Configuration error: TRUSTED_PROXY must be an address or CIDR, not a hop count.\n" +
        "  A hop count is spoofable (GHSA-3m5p-2c4r-xxw2). Use the proxy's address, e.g. 127.0.0.1.",
    );
    process.exit(1);
  }
  return raw;
}

/** True when this process is bound to loopback, so dev-only routes may be served. */
export function onLoopback(): boolean {
  return isLoopbackHost(config.host);
}

export function allowedRpcMethods(): readonly string[] {
  return config.rpcAllowBroadcast ? [...RPC_READ_METHODS, "eth_sendRawTransaction"] : RPC_READ_METHODS;
}
