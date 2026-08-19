import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

// The seed module reads env + files at import; use a temp path and fresh module
// registry per case via dynamic import with a query suffix.
const SEED_PATH = path.join(tmpdir(), `wally-test-seed-${Date.now()}`);

function cleanup() {
  for (const f of [SEED_PATH, SEED_PATH + ".backed"]) {
    if (existsSync(f)) rmSync(f);
  }
}

beforeEach(() => {
  cleanup();
  delete process.env["WDK_SEED"];
  delete process.env["WDK_SEED_COMMAND"];
  delete process.env["WDK_SEED_FILE"];
  process.env["WALLY_SEED_PATH"] = SEED_PATH;
});
afterEach(cleanup);

describe("auto-generated wallet on first run", () => {
  it("generates, persists, and prompts backup when no seed is configured", async () => {
    const mod = await import("../../src/wdk/seed.js?case=gen");
    mod.captureSeed();
    const seed = mod.getCapturedSeed();
    expect(seed).toBeDefined();
    expect(seed!.split(" ").length).toBe(12); // BIP-39 12-word phrase
    expect(existsSync(SEED_PATH)).toBe(true);
    expect(readFileSync(SEED_PATH, "utf8").trim()).toBe(seed);
    // A fresh wallet has a pending backup with the phrase available once.
    expect(mod.isBackupPending()).toBe(true);
    expect(mod.getRecoveryPhraseForBackup()).toBe(seed);
    // After acknowledging, the phrase is no longer served and a marker exists.
    mod.acknowledgeBackup();
    expect(mod.isBackupPending()).toBe(false);
    expect(mod.getRecoveryPhraseForBackup()).toBeNull();
    expect(existsSync(SEED_PATH + ".backed")).toBe(true);
  });

  it("captures a configured plaintext seed instead of generating", async () => {
    process.env["WDK_SEED"] = "cat attack unaware scan crash pioneer example wrap trumpet dirt sword sun";
    const mod = await import("../../src/wdk/seed.js?case=plaintext");
    mod.captureSeed();
    expect(mod.getCapturedSeed()).toContain("cat attack");
    expect(existsSync(SEED_PATH)).toBe(false); // did NOT auto-generate
    expect(mod.isBackupPending()).toBe(false); // configured seed = user's own, no prompt
    // And it is removed from the environment after capture.
    expect(process.env["WDK_SEED"]).toBeUndefined();
  });

  it("defers to WDK_SEED_COMMAND/FILE without generating", async () => {
    process.env["WDK_SEED_FILE"] = "/some/path";
    const mod = await import("../../src/wdk/seed.js?case=file");
    mod.captureSeed();
    expect(mod.getCapturedSeed()).toBeUndefined(); // subprocess resolves it
    expect(existsSync(SEED_PATH)).toBe(false);
  });
});
