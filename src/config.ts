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
  qvacModelId: z.string().min(1),

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

  logLevel: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),

  sessionSecret: z.string().min(16),
});

type Config = z.infer<typeof ConfigSchema>;

function buildConfig(): Config {
  const raw = {
    qvacModelId: process.env["QVAC_MODEL_ID"],
    wdkChains: process.env["WDK_CHAINS"],
    wdkRpcEthereum: process.env["WDK_RPC_ETHEREUM"],
    wdkRpcArbitrum: process.env["WDK_RPC_ARBITRUM"],
    wdkIndexerApiKey: process.env["WDK_INDEXER_API_KEY"] || undefined,
    networkMode: process.env["NETWORK_MODE"],
    gaslessChains: process.env["WALLY_GASLESS_CHAINS"],
    port: process.env["PORT"],
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

  return result.data;
}

export const config = buildConfig();
