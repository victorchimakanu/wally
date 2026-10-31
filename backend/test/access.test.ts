import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Access control, tested against a server built with a key and an origin allowlist actually
 * configured.
 *
 * `config` is built once when src/config.ts is imported, so the rest of the suite — which
 * runs with no WALLY_APP_KEY — can only ever exercise the open-on-loopback path. Mutation
 * testing on 22 Oct 2026 showed what that cost: the suite still passed with `keyMatches`
 * returning true for every key, with the origin allowlist removed, with the rate limiter
 * never refusing, and with `/health?deep=1` left unauthenticated. Five real breaches, none
 * caught.
 *
 * These cases stub the environment and re-import the module graph so the guards run as they
 * would in production.
 */

const KEY = "an-app-key-of-at-least-16-chars";

async function serverWith(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { buildServer } = await import("../src/server.js");
  return buildServer();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("shared key", () => {
  it("refuses a wrong key, a wrong-length key, and no key at all", async () => {
    const app = await serverWith({ WALLY_APP_KEY: KEY });

    const none = await app.inject({ method: "GET", url: "/v1/rpc/methods" });
    expect(none.statusCode, "a request with no key must be refused").toBe(401);

    // Same length, one character different: catches a comparison that ignores content.
    const wrong = await app.inject({
      method: "GET",
      url: "/v1/rpc/methods",
      headers: { "x-wally-key": KEY.slice(0, -1) + "X" },
    });
    expect(wrong.statusCode, "a wrong key of the right length must be refused").toBe(401);

    // Different length: timingSafeEqual throws on this, so the wrapper must return false
    // rather than let the throw become a 500 — or, worse, be swallowed as a match.
    const short = await app.inject({
      method: "GET",
      url: "/v1/rpc/methods",
      headers: { "x-wally-key": "short" },
    });
    expect(short.statusCode, "a wrong-length key must be refused, not error").toBe(401);
  });

  it("accepts the configured key", async () => {
    const app = await serverWith({ WALLY_APP_KEY: KEY });
    const response = await app.inject({
      method: "GET",
      url: "/v1/rpc/methods",
      headers: { "x-wally-key": KEY },
    });
    expect(response.statusCode).toBe(200);
  });

  it("never reveals the key in a refusal", async () => {
    const app = await serverWith({ WALLY_APP_KEY: KEY });
    const response = await app.inject({ method: "GET", url: "/v1/rpc/methods" });
    expect(response.body).not.toContain(KEY);
  });

  it("leaves shallow /health open but not the deep check, which spends upstream calls", async () => {
    const app = await serverWith({ WALLY_APP_KEY: KEY });

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    // A prefix match here would hand an unauthenticated caller a way to burn provider quota.
    expect(
      (await app.inject({ method: "GET", url: "/health?deep=1" })).statusCode,
      "the deep check must require the key",
    ).toBe(401);
  });
});

describe("origin allowlist", () => {
  it("answers a listed origin and refuses an unlisted one", async () => {
    const app = await serverWith({ ALLOWED_ORIGINS: "http://allowed.test" });

    const allowed = await app.inject({
      method: "GET",
      url: "/v1/market?currency=jpy",
      headers: { origin: "http://allowed.test" },
    });
    // 400 for the bad currency, not 403: it reached the route.
    expect(allowed.statusCode).toBe(400);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://allowed.test");

    const refused = await app.inject({
      method: "GET",
      url: "/v1/market?currency=jpy",
      headers: { origin: "http://evil.test" },
    });
    expect(refused.statusCode, "an unlisted origin must be refused").toBe(403);
  });

  it("still serves a request with no Origin at all, which is every native build", async () => {
    const app = await serverWith({ ALLOWED_ORIGINS: "http://allowed.test" });
    const response = await app.inject({ method: "GET", url: "/v1/market?currency=jpy" });
    expect(response.statusCode).toBe(400);
  });
});

describe("rate limiting", () => {
  it("refuses once the per-minute budget is spent", async () => {
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "3" });

    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await app.inject({ method: "GET", url: "/v1/rpc/methods" });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 3), "the budget must be honoured").toEqual([200, 200, 200]);
    expect(codes.slice(3), "requests past the budget must be refused").toEqual([429, 429]);
  });

  it("counts before the key is checked, so guessing keys is bounded too", async () => {
    const app = await serverWith({ WALLY_APP_KEY: KEY, RATE_LIMIT_PER_MINUTE: "2" });

    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/rpc/methods",
        headers: { "x-wally-key": `guess-${i}` },
      });
      codes.push(response.statusCode);
    }
    // 401 while the budget lasts, then 429 — never an unbounded guessing window.
    expect(codes).toEqual([401, 401, 429, 429]);
  });

  it("leaves shallow /health outside the budget, so a monitor cannot lock itself out", async () => {
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "2" });
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
  });
});
