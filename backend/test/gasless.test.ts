import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The bundler and paymaster proxy.
 *
 * This is the only route in the service that spends money when it is used: a sponsorship policy
 * is a budget, and every forwarded paymaster call draws on it. So the cases that matter here are
 * the refusals — an unconfigured service, a method nobody allowed, a submission while
 * broadcasting is off — and the guarantee that nothing is ever served from a cache.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const PIMLICO = "https://api.pimlico.io/v2/421614/rpc?apikey=test-key";

async function serverWith(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  const { buildServer } = await import("../src/server.js");
  return buildServer();
}

/** Records every upstream call so "was this cached?" can be answered by counting. */
function stubUpstream(result: unknown = { jsonrpc: "2.0", id: 1, result: "0x1" }) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

describe("gasless proxy", () => {
  it("says gasless is unavailable rather than failing obscurely when nothing is configured", async () => {
    const app = await serverWith();

    const bundler = await app.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: { method: "eth_chainId" } });
    expect(bundler.statusCode).toBe(503);
    expect(bundler.json().error).toMatch(/gasless transfers are not available/i);

    const paymaster = await app.inject({ method: "POST", url: "/v1/paymaster/arbitrum", payload: { method: "pm_chainId" } });
    expect(paymaster.statusCode).toBe(503);

    // And the app can ask before it offers the feature to anyone.
    expect((await app.inject({ method: "GET", url: "/v1/gasless" })).json().available).toBe(false);
  });

  it("refuses Ethereum with the actual reason, which is not a missing setting", async () => {
    // Ethereum runs @tetherto/wdk-wallet-evm — a plain EOA. There is no user operation to
    // bundle there however the service is configured, and saying "not configured" would send
    // an operator looking for a setting that cannot help.
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    const response = await app.inject({ method: "POST", url: "/v1/bundler/ethereum", payload: { method: "eth_chainId" } });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatch(/only to Arbitrum/i);
  });

  it("forwards an allowed method and returns the caller's own id", async () => {
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    const calls = stubUpstream({ jsonrpc: "2.0", id: 99, result: "0x66eee" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/bundler/arbitrum",
      payload: { jsonrpc: "2.0", id: 7, method: "eth_chainId", params: [] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toBe("0x66eee");
    // 7, not 99: a coalesced response carries whichever id was sent first, and returning
    // someone else's id breaks the caller's request matching.
    expect(response.json().id).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(PIMLICO);
  });

  it("refuses a method nobody allowed, and names what is allowed", async () => {
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    const calls = stubUpstream();

    for (const [url, method] of [
      ["/v1/bundler/arbitrum", "eth_sendRawTransaction"],
      ["/v1/bundler/arbitrum", "pm_getPaymasterData"],
      ["/v1/paymaster/arbitrum", "eth_sendUserOperation"],
      ["/v1/paymaster/arbitrum", "eth_getBalance"],
    ] as const) {
      const response = await app.inject({ method: "POST", url, payload: { method } });
      expect(response.statusCode, `${url} ${method}`).toBe(403);
      expect(response.json().allowed).toBeInstanceOf(Array);
    }
    // Nothing reached the provider, so nothing was spent.
    expect(calls).toHaveLength(0);
  });

  it("gates submitting a user operation behind the same flag as a raw transaction", async () => {
    // Allowing a user operation through while refusing a raw transaction would be an accident,
    // not a policy: both put a user's transaction on chain.
    const off = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    stubUpstream();
    expect((await off.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: { method: "eth_sendUserOperation", params: [] } })).statusCode).toBe(403);
    expect((await off.inject({ method: "GET", url: "/v1/gasless" })).json().submitEnabled).toBe(false);

    const on = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO, RPC_ALLOW_BROADCAST: "true" });
    stubUpstream();
    expect((await on.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: { method: "eth_sendUserOperation", params: [] } })).statusCode).toBe(200);
    expect((await on.inject({ method: "GET", url: "/v1/gasless" })).json().submitEnabled).toBe(true);
  });

  it("never serves a paymaster answer from a cache", async () => {
    // Not a conservative default but a correctness requirement: pm_getPaymasterData is signed
    // over one exact user operation, so a reused answer is invalid rather than stale.
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    const calls = stubUpstream({ jsonrpc: "2.0", id: 1, result: { paymaster: "0x7777", paymasterData: "0xabcd" } });

    const payload = { method: "pm_getPaymasterData", params: [{ sender: "0x1111111111111111111111111111111111111111", nonce: "0x1" }] };
    const first = await app.inject({ method: "POST", url: "/v1/paymaster/arbitrum", payload });
    const second = await app.inject({ method: "POST", url: "/v1/paymaster/arbitrum", payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // Two sequential identical requests must both reach the provider. /v1/rpc caches some
    // reads; this route must not cache anything at all.
    expect(calls).toHaveLength(2);
    expect(first.headers["x-wally-cache"]).toBeUndefined();
  });

  it("collapses identical concurrent calls into one upstream request", async () => {
    // Coalescing is not caching: a burst is one question, and the next request asks again.
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });

    // Held open for 30ms so the burst piles up behind the first call. A stub that resolves
    // instantly lets each flight settle before the next request arrives, which would test the
    // stub rather than the coalescing.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls.push("call");
      await new Promise(resolve => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { maxFeePerGas: "0x1" } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }));

    const payload = { method: "pimlico_getUserOperationGasPrice", params: [] };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload })),
    );

    expect(responses.every(r => r.statusCode === 200)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("rejects batches and malformed requests before reaching the provider", async () => {
    const app = await serverWith({ BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO });
    const calls = stubUpstream();

    // A batch would let one request fan out past the rate limit — which here is the budget's
    // protection, not just a courtesy to the provider.
    //
    // The message is asserted, not just the status. A mutation proved why: with the batch check
    // removed an array still fails the `typeof body.method !== "string"` test below, so the
    // status alone cannot tell the two apart. What the guard actually buys is a reader who is
    // told their batch was the problem instead of being sent to look for a malformed request.
    const batch = await app.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: [{ method: "eth_chainId" }] });
    expect(batch.statusCode).toBe(400);
    expect(batch.json().error).toMatch(/one JSON-RPC request at a time/i);
    expect((await app.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: { method: "eth_chainId", params: "nope" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/bundler/arbitrum", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/bundler/nope", payload: { method: "eth_chainId" } })).statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("requires the app key, because this route spends a budget", async () => {
    const app = await serverWith({
      BUNDLER_URL_ARBITRUM: PIMLICO, PAYMASTER_URL_ARBITRUM: PIMLICO,
      WALLY_APP_KEY: "a-key-at-least-16-chars",
    });
    const calls = stubUpstream();

    const refused = await app.inject({ method: "POST", url: "/v1/paymaster/arbitrum", payload: { method: "pm_chainId" } });
    expect(refused.statusCode).toBe(401);
    expect(calls).toHaveLength(0);

    const allowed = await app.inject({
      method: "POST", url: "/v1/paymaster/arbitrum",
      headers: { "x-wally-key": "a-key-at-least-16-chars" },
      payload: { method: "pm_chainId" },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
