// One-shot ERC-20 approve runner.
//
// Why this exists: the WDK MCP toolkit's lending tools need a token approval
// before supply, but the toolkit ships no approve tool and its generic
// sendTransaction accepts no calldata. So Wally spawns this script as a
// short-lived child process — the same trust boundary as the MCP subprocess:
// the seed enters via env, the process signs one approval, prints the result
// as JSON on stdout, and exits.
//
// Usage: node approve-runner.mjs <chain> <tokenAddress> <spenderAddress> <baseAmount>
//
// The seed is resolved the same way the WDK MCP toolkit resolves it —
// WDK_SEED, WDK_SEED_COMMAND, or WDK_SEED_FILE — so every documented seed
// source works for lending, not just the plaintext development one. The
// parent passes only the variables this process needs, never its full env.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WDK from "@tetherto/wdk";

const [chain, token, spender, amount] = process.argv.slice(2);

function fail(msg) {
  console.log(JSON.stringify({ error: msg }));
  process.exit(1);
}

if (!chain || !token || !spender || !amount) {
  fail("usage: approve-runner.mjs <chain> <token> <spender> <baseAmount>");
}

function resolveSeed() {
  if (process.env.WDK_SEED) return process.env.WDK_SEED.trim();
  if (process.env.WDK_SEED_COMMAND) {
    return execSync(process.env.WDK_SEED_COMMAND, { encoding: "utf8" }).trim();
  }
  if (process.env.WDK_SEED_FILE) {
    return readFileSync(process.env.WDK_SEED_FILE, "utf8").trim();
  }
  return null;
}

const seed = resolveSeed();
if (!seed) fail("No seed source configured (WDK_SEED, WDK_SEED_COMMAND, or WDK_SEED_FILE)");
delete process.env.WDK_SEED;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const wdkConfig = JSON.parse(readFileSync(path.join(root, "wdk.config.json"), "utf8"));
const chainDef = wdkConfig.chains?.[chain];
if (!chainDef) fail(`chain ${chain} is not in wdk.config.json`);

try {
  const { default: WalletManager } = await import(chainDef.module);
  const wdk = new WDK(seed);
  wdk.registerWallet(chain, WalletManager, chainDef.config);
  const account = await wdk.getAccount(chain, 0);

  const result = await account.approve({ token, spender, amount: BigInt(amount) });
  console.log(JSON.stringify({ hash: result.hash, fee: String(result.fee ?? "") }));
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
