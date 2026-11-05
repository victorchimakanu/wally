import { describe, it, expect, vi, afterEach } from "vitest";
import { buildServer } from "../src/server.js";

/**
 * Behaviour that needs an upstream, with `fetch` stubbed.
 *
 * These cover the two things the offline suite cannot see: that /v1/history merges both
 * chains and survives one of them failing, and that the RPC cache never serves a stale
 * answer to a question where staleness costs money.
 *
 * The caches in the routes are module-level and shared across cases here, so every case
 * uses its own address or params rather than relying on test ordering.
 */

const app = buildServer();

afterEach(() => {
  vi.unstubAllGlobals();
});

const HASH = (char: string) => "0x" + char.repeat(64);
const ADDR = (char: string) => "0x" + char.repeat(40);

/** An Etherscan txlist success. `timeStamp` is seconds, as the real API returns. */
function etherscanOk(rows: Array<Record<string, unknown>>) {
  return { status: "1", message: "OK", result: rows };
}

function row(hash: string, seconds: number): Record<string, unknown> {
  return {
    hash,
    from: ADDR("1"),
    to: ADDR("2"),
    value: "1000000000000000000",
    gasUsed: "21000",
    gasPrice: "1000000000",
    timeStamp: String(seconds),
    blockNumber: "100",
    isError: "0",
  };
}

/** Routes every stubbed call by the `chainid` Etherscan V2 selects the chain with. */
function stubByChain(handler: (chainId: string, url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      const chainId = new URL(url).searchParams.get("chainid") ?? "";
      const { status, body } = handler(chainId, url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("/v1/history serves both chains in one call", () => {
  it("merges the two chains and sorts newest first", async () => {
    const calls = stubByChain((chainId) => ({
      status: 200,
      body: etherscanOk([chainId === "421614" ? row(HASH("a"), 1_700_000_200) : row(HASH("b"), 1_700_000_100)]),
    }));

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("a")}` });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    // Both chains were queried, not just a default one.
    expect(calls).toHaveLength(2);
    expect(body.items.map((item: { chain: string }) => item.chain)).toEqual(["arbitrum", "ethereum"]);
    expect(body.errors).toEqual([]);
    // The shape parseHistory() in mobile/src/services/wallet-api.ts requires.
    expect(body).toMatchObject({ version: 1, source: expect.any(String) });
    expect(Number.isSafeInteger(body.fetchedAt) && body.fetchedAt > 0).toBe(true);
    expect(body.items.length).toBeLessThanOrEqual(50);
  });

  it("still returns one chain's transactions when the other fails, and names the failure", async () => {
    stubByChain((chainId) =>
      chainId === "421614"
        ? { status: 200, body: etherscanOk([row(HASH("c"), 1_700_000_300)]) }
        : { status: 403, body: { error: "blocked" } },
    );

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("b")}` });
    // Partial success is success: blanking the screen because one chain is down is worse.
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].chain).toBe("arbitrum");
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toContain("Ethereum Sepolia");
    // Every error must be a plain string; parseHistory rejects anything else.
    expect(body.errors.every((item: unknown) => typeof item === "string")).toBe(true);
  });

  it("answers 503 rather than an empty history when every chain fails", async () => {
    stubByChain(() => ({ status: 403, body: { error: "blocked" } }));

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("c")}` });
    // An empty items[] would be rendered as "no transactions", which is a different claim.
    expect(response.statusCode).toBe(503);
    expect(response.json().errors).toHaveLength(2);
  });

  it("says so explicitly when the indexer key is missing, rather than blaming the network", async () => {
    stubByChain(() => ({
      status: 200,
      body: { status: "0", message: "NOTOK", result: "Missing/Invalid API Key" },
    }));

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("d")}` });
    expect(response.statusCode).toBe(503);
    expect(response.json().errors[0]).toContain("ETHERSCAN_API_KEY");
  });

  it("treats 'no transactions found' as an empty history, not a failure", async () => {
    stubByChain(() => ({
      status: 200,
      body: { status: "0", message: "No transactions found", result: [] },
    }));

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("e")}` });
    // A brand new wallet is not a broken wallet.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [], errors: [] });
  });

  it("returns one chain only when asked for one", async () => {
    const calls = stubByChain(() => ({ status: 200, body: etherscanOk([row(HASH("f"), 1_700_000_400)]) }));

    const response = await app.inject({ method: "GET", url: `/v1/history?chain=ethereum&address=${ADDR("f")}` });
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(response.json().items.every((item: { chain: string }) => item.chain === "ethereum")).toBe(true);
  });

  it("queries a different address per chain when given one", async () => {
    // Arbitrum gets an ERC-4337 smart account in mobile/wdk.config.js, whose address is not
    // the EOA used on Ethereum. One shared address would silently query the wrong account.
    const calls = stubByChain(() => ({ status: 200, body: etherscanOk([]) }));

    const response = await app.inject({
      method: "GET",
      url: `/v1/history?address.arbitrum=${ADDR("1")}&address.ethereum=${ADDR("2")}`,
    });
    expect(response.statusCode).toBe(200);

    const queried = calls.map((url) => {
      const parsed = new URL(url);
      return `${parsed.searchParams.get("chainid")}:${parsed.searchParams.get("address")}`;
    });
    expect(queried).toContain(`421614:${ADDR("1")}`);
    expect(queried).toContain(`11155111:${ADDR("2")}`);
    expect(response.json().addresses).toEqual({ arbitrum: ADDR("1"), ethereum: ADDR("2") });
  });

  it("refuses when a requested chain has no address, naming the chain", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/history?address.arbitrum=${ADDR("1")}` });
    // Falling back to the other chain's address would query the wrong account quietly.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Ethereum Sepolia");
  });

  it("deduplicates a hash the indexer reports twice and caps the list at 50", async () => {
    const duplicated = [row(HASH("7"), 1_700_000_500), row(HASH("7"), 1_700_000_500)];
    const many = Array.from({ length: 60 }, (_, index) =>
      row("0x" + index.toString(16).padStart(64, "0"), 1_700_000_000 + index),
    );
    stubByChain((chainId) => ({
      status: 200,
      body: etherscanOk(chainId === "421614" ? duplicated : many),
    }));

    const response = await app.inject({ method: "GET", url: `/v1/history?address=${ADDR("7")}` });
    const items: Array<{ hash: string; chain: string }> = response.json().items;
    // parseHistory throws outright above 50.
    expect(items.length).toBe(50);
    const ids = items.map((item) => `${item.chain}:${item.hash}`);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("indexer request urls", () => {
  it("asks Blockscout for an address without a filter", async () => {
    // Regression: `?filter=to | from` is rejected by the live service with 422 "Invalid value
    // for enum" (measured 21 Oct 2026), and the endpoint already returns both directions.
    // Unit tests of the response mapping cannot catch a wrong query string, so pin it here.
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { __test } = await import("../src/indexer.js");
    await __test.viaBlockscout("ethereum", ADDR("1"));
    expect(calls[0]).toContain(`/api/v2/addresses/${ADDR("1")}/transactions`);
    expect(calls[0], "a filter parameter is a 422 from the live service").not.toContain("filter");
  });
});

describe("rpc caching never costs a transaction", () => {
  function stubRpc(result: unknown) {
    const fn = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 99, result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  async function call(method: string, params: unknown[], id: number) {
    return app.inject({
      method: "POST",
      url: "/v1/rpc/arbitrum",
      payload: { jsonrpc: "2.0", id, method, params },
    });
  }

  it("serves a repeated balance read from cache, with the caller's own id", async () => {
    const fetchMock = stubRpc("0x1bc16d674ec80000");
    const address = ADDR("8");

    const first = await call("eth_getBalance", [address, "latest"], 1);
    const second = await call("eth_getBalance", [address, "latest"], 2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.headers["x-wally-cache"]).toBe("miss");
    expect(second.headers["x-wally-cache"]).toBe("hit");
    expect(second.json().result).toBe("0x1bc16d674ec80000");
    // The cache was populated by request id 1; request 2 must not be answered with it.
    expect(second.json().id).toBe(2);
  });

  it("keys on params, so two addresses never share a balance", async () => {
    const fetchMock = stubRpc("0x1");
    await call("eth_getBalance", [ADDR("9"), "latest"], 1);
    await call("eth_getBalance", [ADDR("b"), "latest"], 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches the nonce, the fee quote, or a receipt", async () => {
    // Each of these is wrong the moment it is stale: a reused nonce is a rejected
    // transaction, a stale gas price underpays, and a receipt flips from null to final once.
    for (const method of [
      "eth_getTransactionCount",
      "eth_estimateGas",
      "eth_gasPrice",
      "eth_getTransactionReceipt",
      "eth_maxPriorityFeePerGas",
    ]) {
      const fetchMock = stubRpc("0x1");
      const first = await app.inject({
        method: "POST",
        url: "/v1/rpc/arbitrum",
        payload: { jsonrpc: "2.0", id: 1, method, params: [ADDR("c")] },
      });
      await app.inject({
        method: "POST",
        url: "/v1/rpc/arbitrum",
        payload: { jsonrpc: "2.0", id: 2, method, params: [ADDR("c")] },
      });
      expect(fetchMock, `${method} must reach the node every time`).toHaveBeenCalledTimes(2);
      expect(first.headers["x-wally-cache"], `${method} must not be cached`).toBe("bypass");
      vi.unstubAllGlobals();
    }
  });

  it("does not cache a JSON-RPC error, which may be transient", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "busy" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await call("eth_getBalance", [ADDR("d"), "latest"], 1);
    await call("eth_getBalance", [ADDR("d"), "latest"], 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes a JSON-RPC error through untouched instead of turning it into a 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "busy" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const response = await call("eth_getBalance", [ADDR("e"), "latest"], 1);
    expect(response.statusCode).toBe(200);
    expect(response.json().error.code).toBe(-32000);
  });

  it("reports which methods are cached, so the app can reason about freshness", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/rpc/methods" });
    const body = response.json();
    expect(body.cached).toContain("eth_getBalance");
    for (const method of ["eth_getTransactionCount", "eth_estimateGas", "eth_getTransactionReceipt"]) {
      expect(body.cached).not.toContain(method);
    }
  });
});

describe("regressions found by auditing against the app, 22 Oct 2026", () => {
  /**
   * The app validates every amount with this expression and `parseHistory()` throws for the
   * WHOLE list when one item fails, so a single bad value blanks Activity entirely.
   */
  const APP_AMOUNT = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/;

  it("omits an amount too large for the app instead of poisoning the whole list", async () => {
    const { __test } = await import("../src/indexer.js");
    const hash = "0x" + "e".repeat(64);

    // 1e31 wei is the first value the app's parser rejects; free to send on a testnet.
    const huge = __test.fromEtherscan("arbitrum", { hash, value: (10n ** 31n).toString() })!;
    expect(huge.amount, "an unusable amount must be left out, not passed through").toBeUndefined();
    // The transaction itself must survive: the app renders a missing amount as "—".
    expect(huge.hash).toBe(hash);
    expect(huge.explorerUrl).toBe(`${__test.EXPLORERS.arbitrum}/tx/${hash}`);

    const fine = __test.fromEtherscan("arbitrum", { hash, value: (10n ** 30n).toString() })!;
    expect(fine.amount).toBe("1000000000000");
    expect(APP_AMOUNT.test(fine.amount!)).toBe(true);
  });

  it("applies the same cap to Blockscout amounts and to fees", async () => {
    const { __test } = await import("../src/indexer.js");
    const hash = "0x" + "f".repeat(64);

    const tx = __test.fromBlockscout("ethereum", {
      hash,
      status: "ok",
      value: (10n ** 34n).toString(),
      fee: { value: (10n ** 34n).toString() },
    })!;
    expect(tx.amount).toBeUndefined();
    expect(tx.fee).toBeUndefined();
    expect(tx.status).toBe("confirmed");
  });

  it("never emits an amount the app would refuse, across the whole range", async () => {
    const { __test } = await import("../src/indexer.js");
    for (let exp = 0n; exp <= 40n; exp++) {
      const emitted = __test.appSafeEth(10n ** exp);
      if (emitted !== null) expect(APP_AMOUNT.test(emitted), `1e${exp} wei -> ${emitted}`).toBe(true);
    }
  });

  it("permits the key header on the CORS preflight", async () => {
    // A custom header makes the browser preflight, and a preflight that does not list
    // x-wally-key makes it refuse the request. The service requires that header off
    // loopback, so omitting it here breaks every browser request once a key is set.
    const response = await app.inject({
      method: "OPTIONS",
      url: "/v1/market?currency=usd",
      headers: {
        origin: "http://127.0.0.1:8082",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-wally-key",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-headers"]).toContain("x-wally-key");
  });

  it("does not take a forwarded-for header from an untrusted client as the client ip", async () => {
    // Behavioural, not a check on the config function: an earlier version of this test
    // asserted trustProxySetting() !== true, which still passed when server.ts was changed
    // back to `trustProxy: true`. Mutation testing caught that. This asserts what the rate
    // limiter actually keys on.
    const probe = buildServer();
    probe.get("/__probe_ip", async (request) => ({ ip: request.ip }));

    const forged = await probe.inject({
      method: "GET",
      url: "/__probe_ip",
      remoteAddress: "203.0.113.5", // not the trusted proxy
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    expect(forged.json().ip, "a header from an untrusted peer must be ignored").toBe("203.0.113.5");

    const viaProxy = await probe.inject({
      method: "GET",
      url: "/__probe_ip",
      remoteAddress: "127.0.0.1", // the configured reverse proxy
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    expect(viaProxy.json().ip, "the real proxy must still be able to report the client").toBe("198.51.100.9");
  });

  it("serves the development-only QVAC passthrough only on loopback", async () => {
    const { onLoopback } = await import("../src/config.js");
    const models = await app.inject({ method: "GET", url: "/v1/models" });
    if (onLoopback()) {
      // Registered here; it answers or fails upstream, but it is not a 404.
      expect(models.statusCode).not.toBe(404);
    } else {
      expect(models.statusCode, "must not be published from a deployed instance").toBe(404);
    }
  });
});
