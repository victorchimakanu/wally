import { describe, it, expect } from "vitest";
import { classify } from "../../src/agent/intent.js";

const validEthAddress = "0xAbcdef1234567890abcdef1234567890abcdef12";
const validBtcAddress = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

describe("classify — transfer", () => {
  it("classifies a valid ETH transfer", () => {
    const result = classify({
      intent: "transfer",
      params: { chain: "ethereum", token: "USDT", amount: "10", to: validEthAddress },
      reply: "Sending 10 USDT",
    });
    expect(result.intent).toBe("transfer");
  });

  it("rejects an invalid Ethereum address", () => {
    const result = classify({
      intent: "transfer",
      params: { chain: "ethereum", token: "USDT", amount: "10", to: "not-an-address" },
      reply: "Sending",
    });
    expect(result.intent).toBe("unknown");
  });

  it("rejects a BTC address on Ethereum chain", () => {
    const result = classify({
      intent: "transfer",
      params: { chain: "ethereum", token: "ETH", amount: "0.1", to: validBtcAddress },
      reply: "Sending",
    });
    expect(result.intent).toBe("unknown");
  });

  it("rejects a negative amount string", () => {
    const result = classify({
      intent: "transfer",
      params: { chain: "ethereum", token: "USDT", amount: "-5", to: validEthAddress },
      reply: "Sending",
    });
    expect(result.intent).toBe("unknown");
  });

  it("rejects an unknown chain", () => {
    const result = classify({
      intent: "transfer",
      params: { chain: "solana", token: "USDT", amount: "10", to: "abc" },
      reply: "Sending",
    });
    expect(result.intent).toBe("unknown");
  });
});

describe("classify — swap", () => {
  it("classifies a valid swap", () => {
    const result = classify({
      intent: "swap",
      params: { chain: "ethereum", fromToken: "USDT", toToken: "ETH", amount: "50" },
      reply: "Swapping",
    });
    expect(result.intent).toBe("swap");
  });

  it("rejects swap on bitcoin chain", () => {
    const result = classify({
      intent: "swap",
      params: { chain: "bitcoin", fromToken: "BTC", toToken: "ETH", amount: "1" },
      reply: "Swapping",
    });
    expect(result.intent).toBe("unknown");
  });
});

describe("classify — balance", () => {
  it("defaults to all when no chain specified", () => {
    const result = classify({
      intent: "balance",
      params: {},
      reply: "Fetching",
    });
    expect(result.intent).toBe("balance");
    if (result.intent === "balance") {
      expect(result.params.chain).toBe("all");
    }
  });

  it("accepts a specific chain", () => {
    const result = classify({
      intent: "balance",
      params: { chain: "arbitrum" },
      reply: "Fetching",
    });
    expect(result.intent).toBe("balance");
    if (result.intent === "balance") {
      expect(result.params.chain).toBe("arbitrum");
    }
  });
});

describe("classify — unknown", () => {
  it("passes through unknown intent", () => {
    const result = classify({
      intent: "unknown",
      params: {},
      reply: "Please rephrase",
    });
    expect(result.intent).toBe("unknown");
  });

  it("treats unrecognized intent as unknown", () => {
    const result = classify({
      intent: "fly_to_moon",
      params: {},
      reply: "OK",
    });
    expect(result.intent).toBe("unknown");
  });
});

describe("classify — price", () => {
  it("classifies a price query", () => {
    const result = classify({
      intent: "price",
      params: { token: "BTC" },
      reply: "Fetching price",
    });
    expect(result.intent).toBe("price");
    if (result.intent === "price") {
      expect(result.params.token).toBe("BTC");
    }
  });
});
