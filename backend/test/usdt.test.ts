import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { TOKENS, tokensFor } from "../src/config.js";
import { __test } from "../src/indexer.js";

/**
 * USDt in Activity.
 *
 * The danger here is arithmetic, not plumbing: USDt has 6 decimals and ETH has 18, and a token
 * amount run through the ETH scale is wrong by a factor of a million million while still
 * looking like a perfectly ordinary number. Most of these cases exist to pin that.
 */

const { formatUnits, appSafeAmount, fromEtherscanToken } = __test;
const USDT = tokensFor("arbitrum")[0]!;
const HASH = (c: string) => `0x${c.repeat(64)}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("token amounts", () => {
  it("scales by the token's decimals, not by eighteen", () => {
    expect(formatUnits(1_000_000n, 6)).toBe("1");
    expect(formatUnits(10_500_000n, 6)).toBe("10.5");
    expect(formatUnits(1n, 6)).toBe("0.000001");
    expect(formatUnits(12_399_380_000_000_000n, 6)).toBe("12399380000");

    // The same integer under the two scales. If these were ever equal, the bug this file
    // exists to prevent would be present.
    expect(formatUnits(1_000_000n, 18)).not.toBe(formatUnits(1_000_000n, 6));
    expect(formatUnits(0n, 6)).toBe("0");
    expect(formatUnits(5n, 0)).toBe("5");
  });

  it("omits an amount the app's parser would choke on, rather than blanking Activity", () => {
    // parseHistory() in the app throws for the WHOLE list if one item fails, so one absurd
    // spam transfer would otherwise empty the screen. 14 integer digits is past the app's cap.
    expect(appSafeAmount(10n ** 20n, 6)).toBeNull();
    expect(appSafeAmount(999_999_999_999_999n, 6)).toBe("999999999.999999");
    expect(appSafeAmount(0n, 6)).toBe("0");
  });
});

describe("mapping an ERC-20 transfer", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    hash: HASH("a"),
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    value: "10500000",
    contractAddress: USDT.address,
    tokenDecimal: "6",
    gasUsed: "50000",
    gasPrice: "1000000000",
    timeStamp: "1700000000",
    blockNumber: "123",
    ...over,
  });

  it("reads the amount at six decimals and the fee at eighteen", () => {
    const tx = fromEtherscanToken("arbitrum", USDT, row())!;
    expect(tx.amount).toBe("10.5");
    expect(tx.symbol).toBe("USDT");
    // The fee is native ETH even for a token transfer: 50000 * 1 gwei.
    expect(tx.fee).toBe("0.00005");
    expect(tx.status).toBe("confirmed");
    expect(tx.blockNumber).toBe(123);
    expect(tx.submittedAt).toBe(1_700_000_000_000);
    expect(tx.explorerUrl).toBe(`https://sepolia.arbiscan.io/tx/${HASH("a")}`);
  });

  it("uses the pinned decimals, never the ones the record claims", () => {
    // tokenDecimal is whatever a contract says. Trusting a remote number to scale an amount on
    // screen is exactly the mistake this code exists to avoid.
    const lying = fromEtherscanToken("arbitrum", USDT, row({ tokenDecimal: "18" }))!;
    expect(lying.amount).toBe("10.5");

    const missing = fromEtherscanToken("arbitrum", USDT, row({ tokenDecimal: undefined }))!;
    expect(missing.amount).toBe("10.5");
  });

  it("drops a record for a different contract rather than relabelling it", () => {
    // contractaddress filters upstream, but a provider returning something else must never be
    // rendered under our token's symbol.
    expect(fromEtherscanToken("arbitrum", USDT, row({ contractAddress: "0x9999999999999999999999999999999999999999" }))).toBeNull();
    expect(fromEtherscanToken("arbitrum", USDT, row({ contractAddress: undefined }))).toBeNull();
    // Case must not matter — addresses arrive in both casings.
    expect(fromEtherscanToken("arbitrum", USDT, row({ contractAddress: USDT.address.toLowerCase() }))?.symbol).toBe("USDT");
  });

  it("refuses a record with no usable hash", () => {
    expect(fromEtherscanToken("arbitrum", USDT, row({ hash: "nope" }))).toBeNull();
    expect(fromEtherscanToken("arbitrum", USDT, row({ hash: undefined }))).toBeNull();
  });
});

describe("the token list", () => {
  it("agrees with both other copies of this list, address and decimals", () => {
    // Three copies exist and none can import another: this proxy, the app
    // (mobile/src/services/tokens.ts) and the dev wallet server
    // (mobile/scripts/wallet-api-core.mjs, a .mjs script that cannot read a .ts module).
    //
    // This test is the only thing standing between a one-sided edit and a wrong number beside
    // somebody's money — the app formats and cross-checks amounts with its own copy, so a
    // disagreement does not raise an error, it shows a different amount. Same coupling CHAINS
    // already has.
    const copies = {
      app: readFileSync(new URL("../../mobile/src/services/tokens.ts", import.meta.url), "utf8"),
      devServer: readFileSync(new URL("../../mobile/scripts/wallet-api-core.mjs", import.meta.url), "utf8"),
    };

    for (const [where, text] of Object.entries(copies)) {
      for (const token of tokensFor("arbitrum")) {
        expect(text, `${where}: address of ${token.symbol}`).toContain(token.address);
        expect(text, `${where}: symbol ${token.symbol}`).toContain(`symbol: '${token.symbol}'`);
        expect(text, `${where}: decimals of ${token.symbol}`).toContain(`decimals: ${token.decimals}`);
      }
      // Nobody may carry a token the others do not. 18 decimals for USDt is the specific
      // mistake worth naming.
      expect(text, `${where}: Ethereum stays native-only`).toContain("ethereum: []");
      expect(text, `${where}: must not scale USDt by 18`).not.toContain("symbol: 'USDT', decimals: 18");
    }
  });

  it("pins USDt as six decimals on Arbitrum only", () => {
    expect(USDT.symbol).toBe("USDT");
    expect(USDT.decimals).toBe(6);
    expect(USDT.address).toBe("0xE5b6C29411b3ad31C3613BbA0145293fC9957256");
    expect(tokensFor("ethereum")).toEqual([]);
    expect(Object.keys(TOKENS).sort()).toEqual(["arbitrum", "ethereum"]);
  });
});

describe("/v1/history with tokens", () => {
  async function server() {
    vi.resetModules();
    const { buildServer } = await import("../src/server.js");
    return buildServer();
  }

  /** Answers txlist and tokentx differently, as Etherscan does. */
  function stub(tokentx: { ok: boolean; rows?: unknown[] }) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      const action = new URL(url).searchParams.get("action");
      if (action === "tokentx") {
        if (!tokentx.ok) return new Response(JSON.stringify({ status: "0", message: "Max rate limit reached" }), { status: 200, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({ status: "1", message: "OK", result: tokentx.rows ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ status: "1", message: "OK", result: [{
        hash: HASH("b"), from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222", value: "1000000000000000",
        gasUsed: "21000", gasPrice: "1000000000", timeStamp: "1700000100", blockNumber: "9",
        txreceipt_status: "1",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    return calls;
  }

  it("shows a USDt transfer beside a native one, each in its own unit", async () => {
    const app = await server();
    stub({ ok: true, rows: [{
      hash: HASH("c"), from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222", value: "25000000",
      contractAddress: USDT.address, tokenDecimal: "6",
      gasUsed: "60000", gasPrice: "1000000000", timeStamp: "1700000200", blockNumber: "10",
    }] });

    const body = (await app.inject({ method: "GET", url: `/v1/history?address=0x${"a".repeat(40)}&chain=arbitrum` })).json();

    const usdt = body.items.find((i: { symbol?: string }) => i.symbol === "USDT");
    const native = body.items.find((i: { symbol?: string }) => i.symbol === undefined);
    expect(usdt?.amount).toBe("25");
    // Absence of a symbol keeps meaning the native coin, so records written before USDt
    // existed stay valid.
    expect(native?.amount).toBe("0.001");
    // Newest first, across both lists.
    expect(body.items[0].symbol).toBe("USDT");
  });

  it("keeps native history when the token query fails", async () => {
    // Native history is the more important of the two. Losing the token rows is better than
    // losing everything, and a rate limit on one query must not empty the screen.
    const app = await server();
    stub({ ok: false });

    const response = await app.inject({ method: "GET", url: `/v1/history?address=0x${"a".repeat(40)}&chain=arbitrum` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].symbol).toBeUndefined();
  });
});
