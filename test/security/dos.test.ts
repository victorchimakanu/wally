import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env["SESSION_SECRET"] = "test-session-secret-that-is-32chars-long!!";
  process.env["QVAC_SERVER_URL"] = "http://127.0.0.1:11434";
  process.env["QVAC_MODEL"] = "wally-llm";
});

describe("cookie verification never throws (crash-DoS guard)", () => {
  it("returns null for a MAC segment that is 64 chars but >64 bytes", async () => {
    const { verifySessionCookie } = await import("../../src/middleware/auth.js");
    // A multibyte char (é = 2 bytes) plus 63 ASCII = 64 chars, 65 bytes. The
    // old character-length precheck passed this, and timingSafeEqual then threw
    // on unequal byte length — crashing the process in the raw WS upgrade path.
    const mac = "é" + "a".repeat(63); // 64 chars, 65 bytes
    const cookie = `wally_session=id.123.${mac}`;
    expect(() => verifySessionCookie(cookie)).not.toThrow();
    expect(verifySessionCookie(cookie)).toBeNull();
  });

  it("returns null for assorted malformed cookies without throwing", async () => {
    const { verifySessionCookie } = await import("../../src/middleware/auth.js");
    for (const c of [
      "wally_session=",
      "wally_session=onlyonepart",
      "wally_session=a.b",
      "wally_session=" + "\u{1F600}".repeat(20), // emoji, multibyte
      "other=x; wally_session=id.1.ÿÿ",
    ]) {
      expect(() => verifySessionCookie(c)).not.toThrow();
      expect(verifySessionCookie(c)).toBeNull();
    }
  });

  it("access token check never throws on a multibyte header", async () => {
    const { checkAccessToken } = await import("../../src/middleware/auth.js");
    // No token configured (loopback) → always true, and never throws.
    expect(() => checkAccessToken("ééé")).not.toThrow();
  });
});
