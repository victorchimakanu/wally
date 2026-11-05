import { describe, it, expect, vi, afterEach } from "vitest";
import { buildServer } from "../src/server.js";

/**
 * Concurrent load, which a TTL cache alone does nothing for.
 *
 * A cache only helps requests arriving after a result is stored. Everything arriving while the
 * first call is still in flight goes upstream too. Measured 23 Oct 2026, before coalescing:
 * 25 concurrent identical balance reads cost 25 upstream calls, and the same for market data.
 *
 * That matters because phones poll on a timer, so a cache expiry releases a burst all at once
 * and the provider sees the burst — the exact thing this service exists to prevent.
 */

const app = buildServer();

afterEach(() => vi.unstubAllGlobals());

/** Counts upstream calls and holds each one open long enough for a burst to pile up behind it. */
function slowUpstream(body: unknown, delayMs = 30) {
  const calls = { count: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls.count++;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("concurrent requests are coalesced, not multiplied", () => {
  it("costs one upstream call when many phones ask for the same balance at once", async () => {
    const calls = slowUpstream({ jsonrpc: "2.0", id: 1, result: "0x1bc16d674ec80000" });
    const address = "0x" + "a1".repeat(20);

    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        app.inject({
          method: "POST",
          url: "/v1/rpc/arbitrum",
          payload: { jsonrpc: "2.0", id: index, method: "eth_getBalance", params: [address, "latest"] },
        }),
      ),
    );

    expect(calls.count, "25 identical concurrent reads must cost one upstream call").toBe(1);
    // Every caller still gets a correct answer, with its OWN id — a shared in-flight response
    // carries whichever id was sent first, so the id must be substituted back.
    responses.forEach((response, index) => {
      expect(response.statusCode).toBe(200);
      expect(response.json().result).toBe("0x1bc16d674ec80000");
      expect(response.json().id, "each caller must see its own JSON-RPC id").toBe(index);
    });
  });

  it("does not merge different questions", async () => {
    const calls = slowUpstream({ jsonrpc: "2.0", id: 1, result: "0x1" });

    await Promise.all([
      app.inject({ method: "POST", url: "/v1/rpc/arbitrum", payload: { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: ["0x" + "b2".repeat(20), "latest"] } }),
      app.inject({ method: "POST", url: "/v1/rpc/arbitrum", payload: { jsonrpc: "2.0", id: 2, method: "eth_getBalance", params: ["0x" + "c3".repeat(20), "latest"] } }),
      app.inject({ method: "POST", url: "/v1/rpc/ethereum", payload: { jsonrpc: "2.0", id: 3, method: "eth_getBalance", params: ["0x" + "b2".repeat(20), "latest"] } }),
    ]);

    // Two addresses and two chains are three distinct questions; coalescing must not blur them.
    expect(calls.count).toBe(3);
  });

  it("coalesces the nonce too, without ever caching it", async () => {
    const calls = slowUpstream({ jsonrpc: "2.0", id: 1, result: "0x5" });
    const address = "0x" + "d4".repeat(20);
    const ask = (id: number) =>
      app.inject({ method: "POST", url: "/v1/rpc/arbitrum", payload: { jsonrpc: "2.0", id, method: "eth_getTransactionCount", params: [address, "pending"] } });

    const burst = await Promise.all([ask(1), ask(2), ask(3)]);
    expect(calls.count, "simultaneous identical nonce reads are one question").toBe(1);
    expect(burst[0]!.headers["x-wally-cache"], "but the answer is never stored").toBe("bypass");

    // A later, separate read must go upstream again: coalescing is not caching.
    await ask(4);
    expect(calls.count, "a nonce read after the burst must reach the node").toBe(2);
  });

  it("costs one upstream call when many phones ask for prices at once", async () => {
    const calls = slowUpstream([{ id: "bitcoin", current_price: 1 }]);

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => app.inject({ method: "GET", url: "/v1/market?currency=eur" })),
    );

    expect(calls.count, "CoinGecko's public tier must see one request, not 25").toBe(1);
    responses.forEach((response) => expect(response.statusCode).toBe(200));
  });

  it("shares one failure instead of retrying it per caller", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ error: "down" }), { status: 503 });
      }),
    );

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => app.inject({ method: "GET", url: "/v1/market?currency=ngn" })),
    );

    // fetchJson retries a 503 once, so one shared attempt is two upstream calls — not twenty.
    expect(attempts).toBeLessThanOrEqual(2);
    responses.forEach((response) => expect([429, 503]).toContain(response.statusCode));
  });
});
