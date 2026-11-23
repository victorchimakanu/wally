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
const ID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ID_B = "9c858901-8a57-4791-81fe-4c455b099bc9";

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

  it("gives two installations behind one address two budgets", async () => {
    // The whole reason this exists. Carrier-grade NAT is the norm on Nigerian mobile
    // networks, and a per-address budget is one budget divided among strangers.
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "2", RATE_LIMIT_PER_ADDRESS: "100" });
    const ask = (id: string) => app.inject({
      method: "GET", url: "/v1/rpc/methods", headers: { "x-wally-install": id },
    });

    const first = [await ask(ID_A), await ask(ID_A), await ask(ID_A)];
    expect(first.map(r => r.statusCode)).toEqual([200, 200, 429]);
    // The neighbour is untouched by the first one spending its budget.
    expect((await ask(ID_B)).statusCode).toBe(200);
  });

  it("does not let rotating installation ids escape the address ceiling", async () => {
    // The property that stops this being security theatre, and the one a unit test of the
    // limiter cannot establish: that server.ts actually applies both limits. A mutation
    // removing the ceiling survived the suite until this case existed.
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "1000", RATE_LIMIT_PER_ADDRESS: "3" });

    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      // A fresh, perfectly valid id every single request.
      const fresh = `${i.toString(16).padStart(8, "0")}-4f89-41d3-9a0c-0305e82c3301`;
      const response = await app.inject({
        method: "GET", url: "/v1/rpc/methods", headers: { "x-wally-install": fresh },
      });
      codes.push(response.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it("budgets a caller that sends no id per address, as before", async () => {
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "2", RATE_LIMIT_PER_ADDRESS: "100" });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: "GET", url: "/v1/rpc/methods" })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("budgets a junk id per address rather than trusting it", async () => {
    // Otherwise "not a uuid" would be a key like any other, and sending a different one each
    // time would be free.
    const app = await serverWith({ RATE_LIMIT_PER_MINUTE: "2", RATE_LIMIT_PER_ADDRESS: "100" });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({
        method: "GET", url: "/v1/rpc/methods", headers: { "x-wally-install": `junk-${i}` },
      });
      codes.push(response.statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
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

/**
 * The preflight must list every custom header the service reads.
 *
 * This has gone wrong twice. A custom header makes the browser preflight the request, and a
 * preflight that omits it refuses the request outright — the caller sees a network failure
 * rather than a status code, so nothing in the response says why.
 *
 *  - 22 Oct 2026 (#3): `x-wally-key` was missing, and would have broken every browser request
 *    the moment WALLY_APP_KEY was set. Caught before deployment.
 *  - 19 Nov 2026 (#55): `x-wally-install` was added for per-installation rate limiting and not
 *    added here. **Not caught**, because nothing tested it. Measured in a browser on 23 Nov:
 *    `/v1/history` failed, Activity showed "Failed to fetch" and fell back to the dev wallet
 *    server — losing the indexed history the backend exists to fetch — and per-installation
 *    rate limiting silently did nothing in a browser, because the id never arrived.
 *
 * Written over `CUSTOM_HEADERS` rather than over a list repeated here, so a third header is
 * covered on the commit that adds it.
 */
describe("CORS preflight", () => {
  it("lists every custom header the service reads, so a browser can send them", async () => {
    const { CUSTOM_HEADERS } = await import("../src/server.js");
    const app = await serverWith({ ALLOWED_ORIGINS: "http://127.0.0.1:8082", WALLY_APP_KEY: KEY });
    const reply = await app.inject({
      method: "OPTIONS",
      url: "/v1/rpc/arbitrum",
      headers: { origin: "http://127.0.0.1:8082", "access-control-request-method": "POST" },
    });

    expect(reply.statusCode).toBe(204);
    const allowed = String(reply.headers["access-control-allow-headers"] ?? "")
      .split(",").map(part => part.trim().toLowerCase());

    expect(allowed).toContain("content-type");
    expect(CUSTOM_HEADERS.length).toBeGreaterThan(1);
    for (const header of CUSTOM_HEADERS) {
      expect(allowed, `${header} is read by the service but the preflight omits it`).toContain(header.toLowerCase());
    }
    await app.close();
  });

  it("accepts a request that actually carries them", async () => {
    // The preflight is a promise about the real request; this is the real request.
    const app = await serverWith({ ALLOWED_ORIGINS: "http://127.0.0.1:8082", WALLY_APP_KEY: KEY });
    const reply = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:8082", "x-wally-key": KEY, "x-wally-install": ID_A },
    });
    expect(reply.statusCode).toBe(200);
    await app.close();
  });
});
