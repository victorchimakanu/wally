import { describe, expect, it } from "vitest";
import { callerOf, createRateLimiter, INSTALL_HEADER, readInstallId } from "../src/ratelimit.js";

/**
 * Carrier-grade NAT is the norm on Nigerian mobile networks, so a per-address budget is one
 * budget divided among strangers. An installation id separates honest callers from each other.
 *
 * The property these cases exist to hold is the one that is easy to get wrong in the other
 * direction: **an id is not a credential.** A client picks what it sends, so sending a fresh
 * one per request must not buy unlimited budget — the address ceiling has to still apply. A
 * test suite that only proved "two ids get two budgets" would be proving the feature works
 * while missing that it had opened a hole.
 */

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER = "9c858901-8a57-4791-81fe-4c455b099bc9";

const request = (ip: string, headers: Record<string, string | string[] | undefined> = {}) => ({ ip, headers });

describe("reading an installation id", () => {
  it("accepts a UUID, in either case", () => {
    expect(readInstallId(ID)).toBe(ID);
    expect(readInstallId(ID.toUpperCase())).toBe(ID);
  });

  it("refuses anything that is not exactly one", () => {
    // This value becomes a key in a map that lives for a minute, and it is attacker-supplied.
    // Anything questionable is budgeted per address instead, which is not a failure.
    for (const bad of [
      undefined, "", "   ", "not-a-uuid", ID.slice(0, 20), `${ID} `, ` ${ID}`,
      `${ID}${ID}`, "../../etc/passwd", "install:" + ID,
      ID.replace("-", ""), "zzzzzzzz-4f89-41d3-9a0c-0305e82c3301",
    ]) expect(readInstallId(bad as string | undefined), `accepted ${JSON.stringify(bad)}`).toBeNull();
  });

  it("refuses a repeated header rather than joining it", () => {
    // Two headers arrive as an array. Joining them would make one key out of two claims.
    expect(readInstallId([ID, OTHER])).toBeNull();
    expect(readInstallId([ID])).toBeNull();
  });
});

describe("who a request is counted as", () => {
  it("is the installation when one is presented", () => {
    const caller = callerOf(request("1.2.3.4", { [INSTALL_HEADER]: ID }));
    expect(caller.identified).toBe(true);
    expect(caller.key).toBe(`install:${ID}`);
  });

  it("is the address when none is, which is the old behaviour", () => {
    const caller = callerOf(request("1.2.3.4"));
    expect(caller.identified).toBe(false);
    expect(caller.key).toBe("ip:1.2.3.4");
  });

  it("keeps the two namespaces apart", () => {
    // Without the prefixes a client could send an id equal to someone's address and spend
    // their budget.
    expect(callerOf(request("1.2.3.4", { [INSTALL_HEADER]: ID })).key)
      .not.toBe(callerOf(request(ID)).key);
    expect(callerOf(request("1.2.3.4")).key).toMatch(/^ip:/);
  });

  it("falls back to the address when the id is junk", () => {
    expect(callerOf(request("1.2.3.4", { [INSTALL_HEADER]: "nope" })).key).toBe("ip:1.2.3.4");
  });
});

describe("the limiter itself", () => {
  it("allows up to the budget and then refuses", () => {
    const allow = createRateLimiter(3);
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, true]);
    expect(allow("a")).toBe(false);
  });

  it("budgets each key separately — the whole point of an id", () => {
    const allow = createRateLimiter(2);
    allow("install:one"); allow("install:one");
    expect(allow("install:one")).toBe(false);
    // A second phone behind the same carrier address is unaffected.
    expect(allow("install:two")).toBe(true);
  });

  it("starts a fresh window once the minute has passed", () => {
    let clock = 1_000_000;
    const allow = createRateLimiter(1, () => clock);
    expect(allow("a")).toBe(true);
    expect(allow("a")).toBe(false);
    clock += 60_001;
    expect(allow("a")).toBe(true);
  });

  it("refuses new keys rather than growing without bound", () => {
    // An attacker rotating ids is exactly how this map would otherwise grow forever, and that
    // is a memory leak someone else controls.
    let clock = 1_000_000;
    const allow = createRateLimiter(100, () => clock);
    for (let i = 0; i < 10_001; i++) allow(`install:${i}`);
    expect(allow("install:brand-new")).toBe(false);
    // Callers already inside keep their budgets; only growth is refused.
    expect(allow("install:0")).toBe(true);
  });

  it("reclaims the space once those windows expire", () => {
    let clock = 1_000_000;
    const allow = createRateLimiter(100, () => clock);
    for (let i = 0; i < 10_001; i++) allow(`install:${i}`);
    expect(allow("install:brand-new")).toBe(false);
    clock += 60_001;
    expect(allow("install:brand-new")).toBe(true);
  });
});

describe("an id is not a credential", () => {
  it("rotating ids does not escape the address ceiling", () => {
    // The property that stops this being security theatre. Modelled the way server.ts applies
    // them: the address ceiling first, for everyone, then the caller's own budget.
    const perCaller = createRateLimiter(120);
    const perAddress = createRateLimiter(10);
    const attempt = (headers: Record<string, string>) => {
      const caller = callerOf(request("5.6.7.8", headers));
      return perAddress("5.6.7.8") && perCaller(caller.key);
    };

    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      // A fresh, perfectly valid id every single time.
      const fresh = `${i.toString(16).padStart(8, "0")}-4f89-41d3-9a0c-0305e82c3301`;
      if (attempt({ [INSTALL_HEADER]: fresh })) allowed++;
    }
    expect(allowed).toBe(10);
  });

  it("one noisy installation does not spend the whole address ceiling", () => {
    // The converse, and the reason the caller budget is the tighter of the two: a single
    // runaway client must not refuse everyone else behind its carrier address.
    const perCaller = createRateLimiter(5);
    const perAddress = createRateLimiter(100);
    const attempt = (id: string) => perAddress("5.6.7.8") && perCaller(`install:${id}`);

    let noisy = 0;
    for (let i = 0; i < 40; i++) if (attempt(ID)) noisy++;
    expect(noisy).toBe(5);
    // The neighbour is still served.
    expect(attempt(OTHER)).toBe(true);
  });
});
