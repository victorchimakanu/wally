/**
 * Mutation testing for the backend.  Run with: npm run test:mutation
 *
 * Each entry below is a bug someone could plausibly introduce. The mutation is applied, the
 * suite is run, and the file is restored with `git checkout` so a crash cannot leave the tree
 * dirty. If the suite still passes, that mutant SURVIVED: the suite is not protecting that
 * line, whatever the coverage number says.
 *
 * Why this exists. On 22 Oct 2026 the suite was green at 52 passing tests while seven of these
 * mutations survived, five of them in server.ts — every key accepted, the origin allowlist
 * gone, the rate limiter never refusing, the deep health check unauthenticated. Two of the
 * tests meant to cover that code were not testing it at all: one re-implemented the function
 * inline instead of importing it, another asserted a status code that the mutated path
 * returned anyway, and a third compared a constant against itself.
 *
 * Add a mutation whenever you add a guard. A guard with no mutation is a guard nobody has
 * shown to be tested.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(BACKEND, "..");

/** [id, file relative to backend/, find, replace, what the bug would mean] */
const MUTATIONS = [
  // access control
  ["auth-always-match", "src/server.ts",
   "  return timingSafeEqual(a, b);", "  return true;", "any key is accepted"],
  ["auth-length-shortcut", "src/server.ts",
   "  if (a.length !== b.length) return false;", "  if (a.length !== b.length) return true;",
   "a wrong-length key is accepted"],
  ["cors-allow-any-origin", "src/server.ts",
   "      if (!config.allowedOrigins.includes(origin)) {", "      if (false) {",
   "any website may call the API from a browser"],
  ["health-prefix-open", "src/server.ts",
   '    const shallowHealth = request.url === "/health";',
   '    const shallowHealth = request.url.startsWith("/health");',
   "/health?deep=1 becomes unauthenticated"],
  ["ratelimit-off", "src/server.ts",
   "    return window.count <= perMinute;", "    return true;", "the rate limiter never refuses"],
  ["trustproxy-true", "src/server.ts",
   "    trustProxy: trustProxySetting(),", "    trustProxy: true,", "any client may forge its IP"],

  // config
  ["ischain-proto", "src/config.ts",
   '  return typeof value === "string" && Object.hasOwn(CHAINS, value);',
   '  return typeof value === "string" && value in CHAINS;',
   "__proto__ passes chain validation"],
  ["broadcast-always-on", "src/config.ts",
   '  return config.rpcAllowBroadcast ? [...RPC_READ_METHODS, "eth_sendRawTransaction"] : RPC_READ_METHODS;',
   '  return [...RPC_READ_METHODS, "eth_sendRawTransaction"];',
   "broadcasting is enabled regardless of config"],

  // rpc proxy
  ["rpc-allowlist-off", "src/routes/rpc.ts",
   "    if (!allowed.includes(body.method)) {", "    if (false) {",
   "any JSON-RPC method is forwarded"],
  ["rpc-cache-nonce", "src/routes/rpc.ts",
   'const CACHEABLE = new Set(["eth_getBalance", "eth_chainId", "eth_blockNumber", "eth_getCode"]);',
   'const CACHEABLE = new Set(["eth_getBalance", "eth_chainId", "eth_blockNumber", "eth_getCode", "eth_getTransactionCount"]);',
   "the nonce is cached, producing rejected transactions"],
  ["rpc-cache-ignores-params", "src/routes/rpc.ts",
   '    const key = cacheable ? `${chain}:${body.method}:${JSON.stringify(params)}` : "";',
   '    const key = cacheable ? `${chain}:${body.method}` : "";',
   "one address's balance is served for another"],
  ["rpc-batch-allowed", "src/routes/rpc.ts",
   "    if (Array.isArray(body)) {", "    if (false) {",
   "batched requests fan out past the rate limit"],

  // history
  ["history-empty-not-503", "src/routes/history.ts",
   "    if (items.length === 0 && errors.length === chains.length) {", "    if (false) {",
   "a total failure is shown as 'no transactions'"],
  ["history-no-dedupe", "src/routes/history.ts",
   "        if (seen.has(id)) return false;", "        if (false) return false;",
   "the same transaction appears twice"],
  ["history-cap-raised", "src/routes/history.ts",
   "      .slice(0, 50);", "      .slice(0, 500);", "more items than parseHistory accepts"],
  ["history-weak-address", "src/routes/history.ts",
   "const ADDRESS = /^0x[0-9a-fA-F]{40}$/;", "const ADDRESS = /^0x/;",
   "a malformed address reaches the indexer"],

  // indexer
  ["indexer-no-amount-cap", "src/indexer.ts",
   "    const amount = appSafeEth(value);", "    const amount = formatEth(value);",
   "an oversized amount poisons the whole list"],
  ["indexer-wrong-explorer", "src/indexer.ts",
   '  arbitrum: "https://sepolia.arbiscan.io",', '  arbitrum: "https://arbiscan.io",',
   "explorerUrl no longer matches what the app requires"],
  ["indexer-empty-is-error", "src/indexer.ts",
   "    if (/no transactions found/i.test(message)) return [];", "    if (false) return [];",
   "a brand new wallet looks broken"],
  ["indexer-blockscout-filter", "src/indexer.ts",
   "    `${host}/api/v2/addresses/${address}/transactions`,",
   "    `${host}/api/v2/addresses/${address}/transactions?filter=to%20%7C%20from`,",
   "the 422 regression returns"],

  // cache
  ["cache-never-expires", "src/cache.ts",
   "    if (Date.now() - entry.storedAt >= this.ttlMs) return null;", "    if (false) return null;",
   "stale data is served as fresh forever"],
];

const suitePasses = () =>
  spawnSync("npx", ["vitest", "run"], { cwd: BACKEND, encoding: "utf8" }).status === 0;

const restore = (rel) =>
  execFileSync("git", ["checkout", "--", path.join("backend", rel)], { cwd: REPO });

if (!suitePasses()) {
  console.error("The suite is already failing. Fix that before mutation testing means anything.");
  process.exit(1);
}
console.log("baseline passing\n");

const survived = [];
let killed = 0;

for (const [id, rel, find, replace, meaning] of MUTATIONS) {
  const file = path.join(BACKEND, rel);
  const original = readFileSync(file, "utf8");
  if (!original.includes(find)) {
    console.log(`  !! ${id}: anchor not found in ${rel} — the mutation needs updating`);
    survived.push([id, rel, "anchor missing; this mutation no longer tests anything"]);
    continue;
  }
  writeFileSync(file, original.replace(find, replace));
  let caught;
  try {
    caught = !suitePasses();
  } finally {
    restore(rel);
  }
  if (caught) killed++;
  else survived.push([id, rel, meaning]);
  console.log(`  ${caught ? "killed  " : "SURVIVED"}  ${id.padEnd(28)} ${meaning}`);
}

console.log(`\n${killed} killed, ${survived.length} survived, ${MUTATIONS.length} total`);
if (survived.length) {
  console.log("\nUNPROTECTED — the suite passes while these bugs are present:");
  for (const [id, rel, meaning] of survived) console.log(`  - ${id} (${rel}): ${meaning}`);
  process.exit(1);
}
