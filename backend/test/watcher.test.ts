import { describe, expect, it, vi } from "vitest";
import { CONFIRMATIONS, confirmationsFor, createWatcher, deepEnough, stateFromReceipt, isSettled, type Receipt } from "../src/watcher.js";

/**
 * A phone sleeps mid-confirmation, so something has to keep asking. These are mostly about the
 * two ways a watcher can be worse than no watcher: telling someone a transfer failed when it
 * merely has not landed yet, and becoming a list that grows until the process dies.
 */

const HASH = "0x" + "a".repeat(64);
const OTHER = "0x" + "b".repeat(64);
const receipt = (status: string, block = "0x10"): Receipt => ({ status, blockNumber: block });
/**
 * A chain head far above any fixture block, so these cases keep testing what they were written
 * for rather than the confirmation-depth rule, which has its own describe block below.
 */
const settledHead = async () => 1_000_000;

describe("reading a receipt", () => {
  it("treats a missing receipt as pending, never as failure", () => {
    // The ordinary answer for a transaction accepted and not yet in a block. Calling it failed
    // would tell someone their money did not move when it is about to.
    expect(stateFromReceipt(null).state).toBe("pending");
    expect(stateFromReceipt(undefined as never).state).toBe("pending");
    expect(stateFromReceipt({} as Receipt).state).toBe("pending");
    expect(stateFromReceipt("garbage" as never).state).toBe("pending");
  });

  it("reads the two statuses the EVM defines, and nothing else", () => {
    expect(stateFromReceipt(receipt("0x1"))).toEqual({ state: "confirmed", blockNumber: 16 });
    expect(stateFromReceipt(receipt("0x0"))).toEqual({ state: "failed", blockNumber: 16 });
    expect(stateFromReceipt(receipt("0X1")).state).toBe("confirmed");
    // Anything else is not knowing, which is pending.
    expect(stateFromReceipt(receipt("0x2")).state).toBe("pending");
    expect(stateFromReceipt({ status: "success" } as Receipt).state).toBe("pending");
  });

  it("ignores a block number it cannot read rather than inventing one", () => {
    expect(stateFromReceipt({ status: "0x1", blockNumber: "sixteen" }).blockNumber).toBeUndefined();
    expect(stateFromReceipt({ status: "0x1" }).blockNumber).toBeUndefined();
  });

  it("knows which states stop the polling", () => {
    expect(isSettled("confirmed")).toBe(true);
    expect(isSettled("failed")).toBe(true);
    expect(isSettled("pending")).toBe(false);
  });
});

describe("watching", () => {
  it("polls until the chain decides, then stops asking", async () => {
    let answer: Receipt = null;
    const fetchReceipt = vi.fn(async () => answer);
    const watcher = createWatcher({ fetchReceipt, fetchHead: settledHead });

    watcher.watch("arbitrum", HASH);
    await watcher.tick();
    expect(watcher.get("arbitrum", HASH)?.state).toBe("pending");
    expect(fetchReceipt).toHaveBeenCalledTimes(1);

    answer = receipt("0x1");
    await watcher.tick();
    expect(watcher.get("arbitrum", HASH)?.state).toBe("confirmed");
    expect(watcher.get("arbitrum", HASH)?.blockNumber).toBe(16);

    // Settled means settled: no further calls for this hash.
    await watcher.tick();
    expect(fetchReceipt).toHaveBeenCalledTimes(2);
  });

  it("is idempotent, so a retrying app does not multiply the work", () => {
    const watcher = createWatcher({ fetchReceipt: async () => null, fetchHead: settledHead });
    const first = watcher.watch("arbitrum", HASH);
    const again = watcher.watch("arbitrum", HASH.toUpperCase().replace("0X", "0x"));
    expect(again).toBe(first);
    expect(watcher.size()).toBe(1);
  });

  it("keeps the chains apart", () => {
    const watcher = createWatcher({ fetchReceipt: async () => null, fetchHead: settledHead });
    watcher.watch("arbitrum", HASH);
    watcher.watch("ethereum", HASH);
    expect(watcher.size()).toBe(2);
    expect(watcher.get("ethereum", OTHER)).toBeNull();
  });

  it("a node that is down leaves the transfer pending, not failed", async () => {
    // The direction that matters. "I could not ask" must never read as "it did not happen".
    const watcher = createWatcher({ fetchReceipt: async () => { throw new Error("node down"); }, fetchHead: settledHead });
    watcher.watch("arbitrum", HASH);
    await expect(watcher.tick()).resolves.toBeUndefined();
    const watch = watcher.get("arbitrum", HASH)!;
    expect(watch.state).toBe("pending");
    expect(watch.checkedAt).toBeGreaterThan(0);
  });

  it("one failing chain does not stop the others being checked", async () => {
    const fetchReceipt = vi.fn(async (chain: string) => {
      if (chain === "arbitrum") throw new Error("down");
      return receipt("0x1");
    });
    const watcher = createWatcher({ fetchReceipt, fetchHead: settledHead });
    watcher.watch("arbitrum", HASH);
    watcher.watch("ethereum", OTHER);
    await watcher.tick();
    expect(watcher.get("arbitrum", HASH)?.state).toBe("pending");
    expect(watcher.get("ethereum", OTHER)?.state).toBe("confirmed");
  });
});

describe("bounds, so the list cannot become a leak someone else controls", () => {
  it("drops a watch nobody asked about for the whole ttl", () => {
    let clock = 1_000_000;
    const watcher = createWatcher({ fetchReceipt: async () => null, fetchHead: settledHead, now: () => clock, ttlMs: 1000, fetchHead: settledHead });
    watcher.watch("arbitrum", HASH);
    expect(watcher.size()).toBe(1);
    clock += 1001;
    expect(watcher.size()).toBe(0);
    expect(watcher.get("arbitrum", HASH)).toBeNull();
  });

  it("evicts a settled watch before an unsettled one", async () => {
    // A settled answer has already been useful; an unsettled one is still doing its job.
    const answers = new Map<string, Receipt>();
    const watcher = createWatcher({ fetchReceipt: async (_c, hash) => answers.get(hash) ?? null, fetchHead: settledHead, maxWatches: 2, fetchHead: settledHead });
    const settled = "0x" + "1".repeat(64), open = "0x" + "2".repeat(64), fresh = "0x" + "3".repeat(64);

    answers.set(settled, receipt("0x1"));
    watcher.watch("arbitrum", settled);
    watcher.watch("arbitrum", open);
    await watcher.tick();
    expect(watcher.get("arbitrum", settled)?.state).toBe("confirmed");

    watcher.watch("arbitrum", fresh);
    expect(watcher.get("arbitrum", settled)).toBeNull();
    expect(watcher.get("arbitrum", open)).not.toBeNull();
    expect(watcher.get("arbitrum", fresh)).not.toBeNull();
  });

  it("never exceeds its ceiling, whatever is thrown at it", () => {
    const watcher = createWatcher({ fetchReceipt: async () => null, fetchHead: settledHead, maxWatches: 5, fetchHead: settledHead });
    for (let i = 0; i < 100; i++) watcher.watch("arbitrum", "0x" + i.toString(16).padStart(64, "0"));
    expect(watcher.size()).toBeLessThanOrEqual(5);
  });
});

describe("confirmation depth", () => {
  /**
   * A receipt is not finality. The loopback wallet server learned this on 5 November 2026 —
   * until then it said "confirmed" the instant a receipt appeared — and this service, which is
   * what will feed push notifications, had the same bug until 18 November. A push saying "your
   * transfer confirmed" cannot be taken back, so being early here is worse than being slow.
   */
  it("matches the depths the wallet server requires, and never accepts one block", () => {
    expect(CONFIRMATIONS.ethereum).toBe(3);
    expect(CONFIRMATIONS.arbitrum).toBe(2);
    for (const chain of Object.keys(CONFIRMATIONS) as (keyof typeof CONFIRMATIONS)[]) {
      expect(confirmationsFor(chain)).toBeGreaterThan(1);
    }
    // A chain added to CHAINS but forgotten here must not silently accept a single block.
    // The fallback is the strict number, not the convenient one.
    expect(confirmationsFor("optimism" as never)).toBe(3);
    expect(deepEnough("optimism" as never, 100, 101)).toBe(false);
    expect(deepEnough("optimism" as never, 100, 102)).toBe(true);
  });

  it("counts the block holding the transfer as the first confirmation", () => {
    // Ethereum wants 3: mined at 100 is deep enough once the head reaches 102.
    expect(deepEnough("ethereum", 100, 100)).toBe(false);
    expect(deepEnough("ethereum", 100, 101)).toBe(false);
    expect(deepEnough("ethereum", 100, 102)).toBe(true);
    // Arbitrum wants 2.
    expect(deepEnough("arbitrum", 100, 100)).toBe(false);
    expect(deepEnough("arbitrum", 100, 101)).toBe(true);
  });

  it("treats anything unknown as not deep enough", () => {
    // Not being able to ask is not the same as yes, and the failure guarded against is saying
    // yes too early.
    expect(deepEnough("ethereum", undefined, 100)).toBe(false);
    expect(deepEnough("ethereum", 100, undefined)).toBe(false);
    expect(deepEnough("ethereum", Number.NaN, 100)).toBe(false);
    expect(deepEnough("ethereum", 100, Number.NaN)).toBe(false);
    // A head behind the block — two nodes at different heights — is also not a yes.
    expect(deepEnough("ethereum", 100, 98)).toBe(false);
  });

  it("holds a mined transfer at pending until it is deep enough", async () => {
    let head = 100;
    const watcher = createWatcher({
      fetchReceipt: async () => receipt("0x1", "0x64"), // block 100
      fetchHead: async () => head,
    });
    watcher.watch("ethereum", HASH);

    await watcher.tick();
    const shallow = watcher.get("ethereum", HASH);
    expect(shallow?.state).toBe("pending");
    // Recorded even while pending: it is on chain, it is simply not safe to say so yet.
    expect(shallow?.blockNumber).toBe(100);

    head = 101;
    await watcher.tick();
    expect(watcher.get("ethereum", HASH)?.state).toBe("pending");

    head = 102;
    await watcher.tick();
    expect(watcher.get("ethereum", HASH)?.state).toBe("confirmed");
  });

  it("reports a failure immediately, without waiting for depth", async () => {
    // A reorg cannot turn a failure into a success without also changing the hash, so there is
    // nothing to be wrong about — and making someone wait three blocks to learn their transfer
    // did not go through is a cost with no safety behind it.
    const fetchHead = vi.fn(async () => 100);
    const watcher = createWatcher({ fetchReceipt: async () => receipt("0x0", "0x64"), fetchHead });
    watcher.watch("ethereum", HASH);
    await watcher.tick();
    expect(watcher.get("ethereum", HASH)?.state).toBe("failed");
    // And it costs nothing: no head is read when nothing looks confirmed.
    expect(fetchHead).not.toHaveBeenCalled();
  });

  it("leaves a transfer pending when the head cannot be read", async () => {
    const watcher = createWatcher({
      fetchReceipt: async () => receipt("0x1", "0x64"),
      fetchHead: async () => { throw new Error("node down"); },
    });
    watcher.watch("ethereum", HASH);
    await watcher.tick();
    // Still open, so the next round asks again rather than writing it off.
    expect(watcher.get("ethereum", HASH)?.state).toBe("pending");
    expect(watcher.open()).toBe(1);
  });

  it("asks for the head once per chain, not once per transfer", async () => {
    // Fifty transfers settling in the same block are one question about the chain.
    const fetchHead = vi.fn(async () => 1_000_000);
    const watcher = createWatcher({ fetchReceipt: async () => receipt("0x1", "0x64"), fetchHead });
    for (let i = 0; i < 10; i++) watcher.watch("ethereum", "0x" + String(i).padStart(64, "0"));
    watcher.watch("arbitrum", HASH);
    await watcher.tick();
    expect(fetchHead).toHaveBeenCalledTimes(2);
  });
});
