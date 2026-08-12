import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

// Load .env.local first (developer overrides), then .env, at startup.
// We do this before anything else so the process.env values are available.
function loadDotenv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of [".env.local", ".env"]) {
    try {
      const content = readFileSync(path.join(root, file), "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
      }
    } catch {
      // file not found is fine
    }
  }
}

loadDotenv();

const ConfigSchema = z.object({
  // Base URL of the OpenAI-compatible server started with `qvac serve openai`.
  qvacServerUrl: z.string().url().default("http://127.0.0.1:11434"),

  // Model alias registered under serve.models in qvac.config.json.
  qvacModel: z.string().min(1).default("wally-llm"),

  qvacTimeoutMs: z.coerce.number().int().positive().default(120_000),

  // Bearer token for `qvac serve openai --api-key`. Optional on loopback,
  // required (with https) for any non-loopback server URL.
  qvacApiKey: z.string().optional(),

  wdkChains: z
    .string()
    .default("ethereum,arbitrum,bitcoin")
    .transform((s) => s.split(",").map((c) => c.trim()).filter(Boolean)),

  wdkRpcEthereum: z
    .string()
    .url()
    .default("https://rpc.mevblocker.io/fast"),

  wdkRpcArbitrum: z
    .string()
    .url()
    .default("https://arb1.arbitrum.io/rpc"),

  wdkIndexerApiKey: z.string().optional(),

  networkMode: z.enum(["testnet", "mainnet"]).default("testnet"),

  // Chains running the ERC-4337 smart-account wallet (gas paid via paymaster,
  // e.g. in USDT). Skips the native-gas preflight and tx-hash verification,
  // since 4337 returns a user-operation hash, not a transaction hash.
  gaslessChains: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)),

  port: z.coerce.number().int().positive().default(3000),

  // Wally binds to loopback only. Setting HOST to anything else requires
  // WALLY_ALLOW_REMOTE=true — an explicit opt-in to network exposure.
  host: z.string().default("127.0.0.1"),
  allowRemote: z
    .string()
    .default("false")
    .transform((s) => s === "true"),

  // Shared secret required before a session cookie is issued when the server
  // is reachable off-loopback. Mandatory whenever allowRemote is true.
  accessToken: z.string().optional(),

  logLevel: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  // Signs session cookies. Must be real entropy — the known placeholders are
  // rejected because they ship in the public repo and would let anyone forge a
  // valid cookie.
  sessionSecret: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters (openssl rand -base64 32)")
    .refine(
      (v) => !["change-me", "change-me-in-production", "changeme"].includes(v.trim().toLowerCase()),
      "SESSION_SECRET is still a placeholder — generate a real one with: openssl rand -base64 32"
    ),
});

type Config = z.infer<typeof ConfigSchema>;

function buildConfig(): Config {
  const raw = {
    qvacServerUrl: process.env["QVAC_SERVER_URL"],
    qvacModel: process.env["QVAC_MODEL"],
    qvacTimeoutMs: process.env["QVAC_TIMEOUT_MS"],
    qvacApiKey: process.env["QVAC_API_KEY"] || undefined,
    wdkChains: process.env["WDK_CHAINS"],
    wdkRpcEthereum: process.env["WDK_RPC_ETHEREUM"],
    wdkRpcArbitrum: process.env["WDK_RPC_ARBITRUM"],
    wdkIndexerApiKey: process.env["WDK_INDEXER_API_KEY"] || undefined,
    networkMode: process.env["NETWORK_MODE"],
    gaslessChains: process.env["WALLY_GASLESS_CHAINS"],
    port: process.env["PORT"],
    host: process.env["HOST"],
    allowRemote: process.env["WALLY_ALLOW_REMOTE"],
    accessToken: process.env["WALLY_ACCESS_TOKEN"] || undefined,
    logLevel: process.env["LOG_LEVEL"],
    sessionSecret: process.env["SESSION_SECRET"],
  };

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error("Configuration error — fix your .env file and restart:\n" + issues);
    process.exit(1);
  }

  const cfg = result.data;

  // Inference is on-device only when the QVAC server is loopback. A remote
  // server means chat context leaves this machine, so it must be explicit,
  // encrypted, and authenticated — otherwise refuse to start.
  const qvacHost = new URL(cfg.qvacServerUrl);
  const qvacLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(qvacHost.hostname);
  if (!qvacLoopback && (qvacHost.protocol !== "https:" || !cfg.qvacApiKey)) {
    console.error(
      "Configuration error: QVAC_SERVER_URL is not loopback. Remote QVAC servers require " +
        "https and QVAC_API_KEY (start the server with `qvac serve openai --api-key <key>`). " +
        "Note that with a remote server, message parsing is no longer on-device."
    );
    process.exit(1);
  }

  const hostLoopback = ["127.0.0.1", "localhost", "::1"].includes(cfg.host);
  if (!hostLoopback && !cfg.allowRemote) {
    console.error(
      "Configuration error: HOST is not loopback. Exposing Wally's wallet interface to the " +
        "network requires WALLY_ALLOW_REMOTE=true. Do not do this on untrusted networks."
    );
    process.exit(1);
  }

  // Off-loopback exposure without a shared access secret would hand a session
  // (and the wallet) to anyone who can reach the port. Refuse to start.
  if (cfg.allowRemote && (!cfg.accessToken || cfg.accessToken.length < 16)) {
    console.error(
      "Configuration error: WALLY_ALLOW_REMOTE=true requires WALLY_ACCESS_TOKEN (>=16 chars). " +
        "Clients must present it before a session cookie is issued."
    );
    process.exit(1);
  }

  // A plaintext seed in the environment is a real-funds risk. On mainnet,
  // prefer a non-plaintext source (command or file). A plaintext WDK_SEED on
  // mainnet is refused unless the operator explicitly opts in, and even then
  // it is captured out of the environment at startup (see captureSeed()).
  if (
    cfg.networkMode === "mainnet" &&
    process.env["WDK_SEED"] &&
    !process.env["WDK_SEED_COMMAND"] &&
    !process.env["WDK_SEED_FILE"] &&
    process.env["WALLY_ALLOW_PLAINTEXT_SEED"] !== "true"
  ) {
    console.error(
      "Configuration error: plaintext WDK_SEED with NETWORK_MODE=mainnet. Prefer WDK_SEED_COMMAND " +
        "or WDK_SEED_FILE. To run a small demo wallet with a plaintext seed anyway, set " +
        "WALLY_ALLOW_PLAINTEXT_SEED=true (use only a throwaway wallet with minimal funds)."
    );
    process.exit(1);
  }

  return cfg;
}

export const config = buildConfig();
