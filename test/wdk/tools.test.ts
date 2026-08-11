// Unit tests for WDK tool helpers.
// These mock the wdk/client.ts layer so no real MCP subprocess is needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/wdk/client.js", () => ({
  getBalance: vi.fn(),
  getTokenBalance: vi.fn(),
  quoteTransfer: vi.fn(),
  transfer: vi.fn(),
  quoteSwap: vi.fn(),
  swap: vi.fn(),
  getPrice: vi.fn(),
  listAvailableTools: vi.fn(),
}));

import * as client from "../../src/wdk/client.js";
import { explorerUrl, fetchAllBalances, quoteAndDescribeTransfer } from "../../src/wdk/tools.js";

describe("explorerUrl", () => {
  it("returns etherscan URL for ethereum", () => {
    const url = explorerUrl("ethereum", "0xabc123");
    expect(url).toBe("https://etherscan.io/tx/0xabc123");
  });

  it("returns arbiscan URL for arbitrum", () => {
    expect(explorerUrl("arbitrum", "0xdef")).toBe("https://arbiscan.io/tx/0xdef");
  });

  it("returns mempool URL for bitcoin", () => {
    expect(explorerUrl("bitcoin", "abc123txid")).toBe("https://mempool.space/tx/abc123txid");
  });

  it("returns empty string for unknown chain", () => {
    expect(explorerUrl("solana", "sig")).toBe("");
  });
});

describe("fetchAllBalances", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns balances for each chain", async () => {
    vi.mocked(client.getBalance).mockResolvedValue("0.5 ETH");
    vi.mocked(client.getTokenBalance).mockResolvedValue("100.00 USDT");

    const result = await fetchAllBalances(["ethereum"]);

    expect(result).toHaveLength(2); // native ETH + USDT
    expect(result[0]).toMatchObject({ chain: "ethereum", token: "native" });
    expect(result[1]).toMatchObject({ chain: "ethereum", token: "USDT" });
  });

  it("skips a chain that errors", async () => {
    vi.mocked(client.getBalance).mockRejectedValue(new Error("RPC error"));

    const result = await fetchAllBalances(["ethereum"]);
    expect(result).toHaveLength(0);
  });

  it("handles multiple chains independently", async () => {
    vi.mocked(client.getBalance)
      .mockResolvedValueOnce("0.1 ETH")
      .mockResolvedValueOnce("0.01 ETH");
    vi.mocked(client.getTokenBalance).mockResolvedValue("50 USDT");

    const result = await fetchAllBalances(["ethereum", "arbitrum"]);
    expect(result.map((b) => b.chain)).toContain("ethereum");
    expect(result.map((b) => b.chain)).toContain("arbitrum");
  });
});

describe("quoteAndDescribeTransfer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a fee and summary from the WDK response", async () => {
    vi.mocked(client.quoteTransfer).mockResolvedValue(
      "Estimated fee: $0.05. Gas: 21000 units."
    );

    const result = await quoteAndDescribeTransfer("ethereum", "USDT", "10", "0xrecipient");
    expect(result.summary).toContain("$0.05");
    expect(result.fee).toBeTruthy();
  });
});
