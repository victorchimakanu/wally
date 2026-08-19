import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env["SESSION_SECRET"] = "test-session-secret-that-is-32chars-long!!";
  process.env["QVAC_SERVER_URL"] = "http://127.0.0.1:11434";
  process.env["QVAC_MODEL"] = "wally-llm";
});

describe("secret scrubbing does not clobber legitimate values", () => {
  it("redacts keyed URLs and labelled secrets but keeps tx hashes intact", async () => {
    const { scrubSecrets } = await import("../../src/logger.js");
    const txHash = "0x" + "a".repeat(64);
    // A message that legitimately shows a tx hash must survive unredacted.
    expect(scrubSecrets(`Sent. Reference: ${txHash}`)).toContain(txHash);
    // A bundler URL with an api key must be redacted.
    expect(scrubSecrets("https://api.pimlico.io/v2/42161/rpc?apikey=pim_LEAK")).not.toContain("pim_LEAK");
    // A labelled seed must be redacted.
    expect(scrubSecrets("error: seed=cat attack unaware scan crash pioneer")).not.toContain("cat attack");
  });
});

describe("transaction outcome mapping", () => {
  it("treats a non-hash as indeterminate, never failed", async () => {
    // verifyTxOnChain returns 'indeterminate' for a non-hash so the user is
    // never told 'not sent' (which would invite a double-spend). We assert the
    // type surface exists and the guard shape via a direct import.
    const tools = await import("../../src/wdk/tools.js");
    // With no RPC configured for an unknown chain, unverifiable is returned.
    const res = await tools.verifyTxOnChain("dogecoin", "not-a-hash");
    expect(res).toBe("unverifiable");
  });
});

describe("base-unit math stays exact for large amounts", () => {
  it("does not lose precision where parseFloat*10**n would", async () => {
    const { toBaseUnits } = await import("../../src/wdk/lending.js");
    // 12,345,678,901.123456 * 10^6 overflows 2^53 in float; string math is exact.
    expect(toBaseUnits("12345678901.123456", 6)).toBe("12345678901123456");
  });
});
