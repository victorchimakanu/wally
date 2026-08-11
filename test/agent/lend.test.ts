import { describe, it, expect } from "vitest";
import { classify, MAX_LTV_PERCENT } from "../../src/agent/intent.js";
import { storePendingLend, takePendingLend, clearPendingLend } from "../../src/agent/lend.js";
import { computeBorrowAmount } from "../../src/wdk/lending.js";

describe("lend_borrow intent classification", () => {
  it("classifies a full lend_borrow with numeric ltv", () => {
    const result = classify({
      intent: "lend_borrow",
      params: { chain: "arbitrum", collateralToken: "USDT", collateralAmount: "200", borrowToken: "USDT", ltv: 50 },
      reply: "ok",
    });
    expect(result.intent).toBe("lend_borrow");
    if (result.intent === "lend_borrow") {
      expect(result.params.ltv).toBe(50);
      expect(result.params.collateralAmount).toBe("200");
    }
  });

  it("normalizes a percent-string ltv", () => {
    const result = classify({
      intent: "lend_borrow",
      params: { chain: "arbitrum", collateralToken: "USDT", collateralAmount: "100", borrowToken: "USDT", ltv: "50%" },
      reply: "ok",
    });
    expect(result.intent).toBe("lend_borrow");
    if (result.intent === "lend_borrow") expect(result.params.ltv).toBe(50);
  });

  it("keeps ltv undefined when the user did not state one", () => {
    const result = classify({
      intent: "lend_borrow",
      params: { chain: "arbitrum", collateralToken: "USDT", collateralAmount: "100", borrowToken: "USDT" },
      reply: "what ltv?",
    });
    expect(result.intent).toBe("lend_borrow");
    if (result.intent === "lend_borrow") expect(result.params.ltv).toBeUndefined();
  });

  it("rejects an ltv above the cap", () => {
    const result = classify({
      intent: "lend_borrow",
      params: { chain: "arbitrum", collateralToken: "USDT", collateralAmount: "100", borrowToken: "USDT", ltv: MAX_LTV_PERCENT + 10 },
      reply: "ok",
    });
    expect(result.intent).toBe("unknown");
  });

  it("defaults chain and tokens when omitted", () => {
    const result = classify({
      intent: "lend_borrow",
      params: { collateralAmount: "50" },
      reply: "ok",
    });
    expect(result.intent).toBe("lend_borrow");
    if (result.intent === "lend_borrow") {
      expect(result.params.chain).toBe("arbitrum");
      expect(result.params.collateralToken).toBe("USDT");
      expect(result.params.borrowToken).toBe("USDT");
    }
  });
});

describe("LTV slot-filling", () => {
  const params = { chain: "arbitrum" as const, collateralToken: "USDT", collateralAmount: "200", borrowToken: "USDT" };

  it.each(["50", "50%", "at 50%", "50 percent", " 50 % ", "50% ltv"])(
    "completes pending params from answer %j",
    (answer) => {
      storePendingLend("s1", params);
      const completed = takePendingLend("s1", answer);
      expect(completed).not.toBeNull();
      expect(completed!.ltv).toBe(50);
    }
  );

  it("ignores unrelated messages and keeps the pending state", () => {
    storePendingLend("s2", params);
    expect(takePendingLend("s2", "what is my balance")).toBeNull();
    expect(takePendingLend("s2", "50")).not.toBeNull();
  });

  it("rejects an out-of-range answer", () => {
    storePendingLend("s3", params);
    expect(takePendingLend("s3", "95%")).toBeNull();
    clearPendingLend("s3");
  });

  it("returns null with no pending state", () => {
    expect(takePendingLend("s4", "50")).toBeNull();
  });
});

describe("computeBorrowAmount", () => {
  it("computes a stable-to-stable borrow at 50% ltv", () => {
    expect(computeBorrowAmount("200", 1, 1, 50)).toBe("100");
  });

  it("rounds down so the requested LTV is never exceeded", () => {
    // 100 * 0.333 = 33.3 → floor to 2 decimals
    expect(parseFloat(computeBorrowAmount("100", 1, 1, 33.333))).toBeLessThanOrEqual(33.34);
  });

  it("prices a non-stable borrow token", () => {
    // 1000 USDT collateral, borrow token at $2000, 50% ltv → 0.25
    expect(computeBorrowAmount("1000", 1, 2000, 50)).toBe("0.25");
  });
});
