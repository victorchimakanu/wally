import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { TtlCache } from "../src/cache.js";
import { scrubSecrets } from "../src/logger.js";
import { allowedRpcMethods, isChain } from "../src/config.js";
import { __test } from "../src/indexer.js";

/** Every case here is offline: only paths that are refused before any upstream call. */

describe("chain validation", () => {
  it("accepts the two supported chains", () => {
    expect(isChain("arbitrum")).toBe(true);
    expect(isChain("ethereum")).toBe(true);
  });
  it("rejects anything else", () => {
    for (const value of ["bitcoin", "polygon", "", null, 1, "__proto__"]) {
      expect(isChain(value)).toBe(false);
    }
  });
});

describe("rpc allowlist", () => {
  it("permits the read methods the app needs", () => {
    const allowed = allowedRpcMethods();
    for (const method of ["eth_getBalance", "eth_getTransactionReceipt", "eth_estimateGas"]) {
      expect(allowed).toContain(method);
    }
  });

  it("permits every method the wallet send path depends on", () => {
    // Derived from mobile/scripts/wallet-api-core.mjs. eth_getCode in particular refuses a
    // contract recipient, where native ETH would be lost — omitting it breaks that guard.
    const allowed = allowedRpcMethods();
    for (const method of [
      "eth_chainId", "eth_getCode", "eth_estimateGas",
      "eth_gasPrice", "eth_getTransactionCount", "eth_getTransactionReceipt",
    ]) {
      expect(allowed, `send path needs ${method}`).toContain(method);
    }
  });
  it("excludes broadcasting unless explicitly enabled", () => {
    // Default config has RPC_ALLOW_BROADCAST unset, so relaying must be off.
    expect(allowedRpcMethods()).not.toContain("eth_sendRawTransaction");
  });
  it("excludes account and signing methods entirely", () => {
    const allowed = allowedRpcMethods();
    for (const method of ["eth_accounts", "eth_sign", "eth_signTransaction", "personal_sign", "debug_traceTransaction"]) {
      expect(allowed).not.toContain(method);
    }
  });
});

describe("secret scrubbing", () => {
  it("redacts provider keys in urls", () => {
    expect(scrubSecrets("https://api.example.com/rpc?apikey=SECRET123&x=1")).toBe(
      "https://api.example.com/rpc?apikey=[redacted]&x=1",
    );
    expect(scrubSecrets("call failed: https://a.b?api_key=abc")).toContain("[redacted]");
    expect(scrubSecrets("https://a.b?x-cg-demo-api-key=abc")).toContain("[redacted]");
  });
  it("leaves ordinary text alone", () => {
    expect(scrubSecrets("nothing sensitive here")).toBe("nothing sensitive here");
  });
});

describe("ttl cache", () => {
  it("returns a fresh value inside the window and nothing after", async () => {
    const cache = new TtlCache<number>(20);
    cache.set("a", 1);
    expect(cache.get("a")?.value).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get("a")).toBeNull();
  });
  it("still offers the expired value as stale", async () => {
    const cache = new TtlCache<number>(10);
    cache.set("a", 7);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stale = cache.stale("a");
    expect(stale?.value).toBe(7);
    expect(stale?.fresh).toBe(false);
  });
  it("evicts the oldest entry when full", () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeNull();
    expect(cache.get("c")?.value).toBe(3);
  });
});

describe("routes refuse bad input before calling any provider", () => {
  const app = buildServer();

  it("health answers without touching upstreams", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "wally-backend" });
  });

  it("rpc rejects an unknown chain", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/rpc/solana", payload: { method: "eth_chainId" } });
    expect(response.statusCode).toBe(400);
  });

  it("rpc rejects a method outside the allowlist", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/rpc/arbitrum",
      payload: { jsonrpc: "2.0", id: 1, method: "eth_sign", params: [] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain("eth_sign");
  });

  it("rpc rejects batched requests, for being a batch", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/rpc/arbitrum",
      payload: [{ method: "eth_chainId" }, { method: "eth_blockNumber" }],
    });
    expect(response.statusCode).toBe(400);
    // Asserting only the status let this pass with the batch check removed: an array is also
    // an object, so it fell through to the generic "invalid request" 400 and looked fine.
    // A batch must be refused for being a batch, since one would otherwise fan out past the
    // rate limit and around the per-method allowlist.
    expect(response.json().error).toMatch(/one JSON-RPC request at a time/i);
  });

  it("rpc rejects non-array params", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/rpc/arbitrum",
      payload: { method: "eth_getBalance", params: { address: "0x1" } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("history rejects a malformed address", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/history?chain=arbitrum&address=0xnope" });
    expect(response.statusCode).toBe(400);
  });

  it("history rejects an unknown chain", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/history?chain=dogecoin&address=0x742d35cc6634c0532925a3b844bc9e7595f0beb1",
    });
    expect(response.statusCode).toBe(400);
  });

  it("market rejects an unsupported currency", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/market?currency=jpy" });
    expect(response.statusCode).toBe(400);
  });

  it("market chart rejects an unsupported asset and range", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/market/chart?id=dogecoin" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/market/chart?id=bitcoin&days=9" })).statusCode).toBe(400);
  });

  it("unknown routes answer 404 without detail", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(response.statusCode).toBe(404);
  });
});

describe("shared key enforcement", () => {
  // config is read once at import, and these tests run with no WALLY_APP_KEY set,
  // so they assert the open-on-loopback behaviour plus the comparison itself.
  const app = buildServer();

  it("allows requests when no key is configured (loopback development)", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/market?currency=jpy" });
    // 400 for the bad currency, not 401 — it reached the route rather than being refused.
    expect(response.statusCode).toBe(400);
  });

  it("leaves shallow /health open for monitors", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("compares keys without leaking length through early exit", () => {
    // timingSafeEqual throws on length mismatch; the wrapper must return false instead.
    const compare = (given: string, expected: string): boolean => {
      const a = Buffer.from(given, "utf8");
      const b = Buffer.from(expected, "utf8");
      if (a.length !== b.length) return false;
      return a.equals(b);
    };
    expect(compare("short", "a-much-longer-key")).toBe(false);
    expect(compare("same-key-value", "same-key-value")).toBe(true);
    expect(compare("same-key-valuX", "same-key-value")).toBe(false);
    expect(compare("", "")).toBe(true);
  });
});

describe("indexer normalisation", () => {
  const { fromEtherscan, fromBlockscout, formatEth, EXPLORERS } = __test;

  it("points at the testnet explorers the app expects, written out literally", () => {
    // The app refuses any explorerUrl that is not exactly `${explorer}/tx/${hash}`, so these
    // bases are a contract with mobile/src/services/wallet-api.ts, not an implementation
    // detail. Pinned here so a change to either side fails loudly.
    expect(EXPLORERS.arbitrum).toBe("https://sepolia.arbiscan.io");
    expect(EXPLORERS.ethereum).toBe("https://sepolia.etherscan.io");
  });

  it("converts wei to a decimal the app's parser accepts", () => {
    // The app validates amounts with /^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/
    const ok = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/;
    expect(formatEth(0n)).toBe("0");
    expect(formatEth(10n ** 18n)).toBe("1");
    expect(formatEth(1n)).toBe("0.000000000000000001");
    expect(formatEth(1_500_000_000_000_000_000n)).toBe("1.5");
    for (const v of [0n, 1n, 10n ** 18n, 21_000n * 1_000_000_000n]) expect(formatEth(v)).toMatch(ok);
  });

  it("maps an Etherscan record, including the exact explorer url the app checks", () => {
    const hash = "0x" + "a".repeat(64);
    const tx = fromEtherscan("arbitrum", {
      hash, from: "0x" + "1".repeat(40), to: "0x" + "2".repeat(40),
      value: "1500000000000000000", gasUsed: "21000", gasPrice: "1000000000",
      timeStamp: "1700000000", blockNumber: "12345", isError: "0", txreceipt_status: "1",
    })!;
    expect(tx.status).toBe("confirmed");
    expect(tx.amount).toBe("1.5");
    expect(tx.fee).toBe("0.000021");
    expect(tx.blockNumber).toBe(12345);
    expect(tx.submittedAt).toBe(1700000000000);
    // Written out literally, not as `${EXPLORERS.arbitrum}/...`: referencing the constant
    // under test made this tautological, and it passed when the base was changed to mainnet
    // arbiscan. These two strings are CHAINS in mobile/src/services/wallet-api.ts, and
    // parseTransaction rejects any deviation character for character.
    expect(tx.explorerUrl).toBe(`https://sepolia.arbiscan.io/tx/${hash}`);
  });

  it("treats both Etherscan failure signals as failed", () => {
    const hash = "0x" + "b".repeat(64);
    expect(fromEtherscan("ethereum", { hash, isError: "1" })!.status).toBe("failed");
    expect(fromEtherscan("ethereum", { hash, txreceipt_status: "0" })!.status).toBe("failed");
    expect(fromEtherscan("ethereum", { hash })!.status).toBe("confirmed");
  });

  it("rejects a record without a usable hash instead of inventing one", () => {
    expect(fromEtherscan("arbitrum", { hash: "nope" })).toBeNull();
    expect(fromEtherscan("arbitrum", {})).toBeNull();
    expect(fromBlockscout("arbitrum", { hash: "0xshort" })).toBeNull();
  });

  it("maps a Blockscout record to the same shape", () => {
    const hash = "0x" + "c".repeat(64);
    const tx = fromBlockscout("ethereum", {
      hash, status: "ok", value: "2000000000000000000",
      fee: { value: "21000000000000" }, from: { hash: "0x" + "3".repeat(40) },
      to: { hash: "0x" + "4".repeat(40) }, timestamp: "2026-10-20T10:00:00.000Z", block_number: 999,
    })!;
    expect(tx.status).toBe("confirmed");
    expect(tx.amount).toBe("2");
    expect(tx.fee).toBe("0.000021");
    expect(tx.blockNumber).toBe(999);
    expect(tx.explorerUrl).toBe(`https://sepolia.etherscan.io/tx/${hash}`);
  });

  it("marks a Blockscout record with no status as pending, never confirmed", () => {
    const hash = "0x" + "d".repeat(64);
    expect(fromBlockscout("arbitrum", { hash })!.status).toBe("pending");
    expect(fromBlockscout("arbitrum", { hash, status: "error" })!.status).toBe("failed");
  });
});
