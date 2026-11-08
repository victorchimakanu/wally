import { describe, expect, it, vi } from "vitest";
import { createWatcher, stateFromReceipt, isSettled, type Receipt } from "../src/watcher.js";

/**
 * A phone sleeps mid-confirmation, so something has to keep asking. These are mostly about the
 * two ways a watcher can be worse than no watcher: telling someone a transfer failed when it
 * merely has not landed yet, and becoming a list that grows until the process dies.
 */

const HASH = "0x" + "a".repeat(64);
const OTHER = "0x" + "b".repeat(64);
const receipt = (status: string, block = "0x10"): Receipt => ({ status, blockNumber: block });

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
    const watcher = createWatcher({ fetchReceipt });

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
    const watcher = createWatcher({ fetchReceipt: async () => null });
    const first = watcher.watch("arbitrum", HASH);
    const again = watcher.watch("arbitrum", HASH.toUpperCase().replace("0X", "0x"));
    expect(again).toBe(first);
    expect(watcher.size()).toBe(1);
  });

  it("keeps the chains apart", () => {
    const watcher = createWatcher({ fetchReceipt: async () => null });
    watcher.watch("arbitrum", HASH);
    watcher.watch("ethereum", HASH);
    expect(watcher.size()).toBe(2);
    expect(watcher.get("ethereum", OTHER)).toBeNull();
  });

  it("a node that is down leaves the transfer pending, not failed", async () => {
    // The direction that matters. "I could not ask" must never read as "it did not happen".
    const watcher = createWatcher({ fetchReceipt: async () => { throw new Error("node down"); } });
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
    const watcher = createWatcher({ fetchReceipt });
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
    const watcher = createWatcher({ fetchReceipt: async () => null, now: () => clock, ttlMs: 1000 });
    watcher.watch("arbitrum", HASH);
    expect(watcher.size()).toBe(1);
    clock += 1001;
    expect(watcher.size()).toBe(0);
    expect(watcher.get("arbitrum", HASH)).toBeNull();
  });

  it("evicts a settled watch before an unsettled one", async () => {
    // A settled answer has already been useful; an unsettled one is still doing its job.
    const answers = new Map<string, Receipt>();
    const watcher = createWatcher({ fetchReceipt: async (_c, hash) => answers.get(hash) ?? null, maxWatches: 2 });
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
    const watcher = createWatcher({ fetchReceipt: async () => null, maxWatches: 5 });
    for (let i = 0; i < 100; i++) watcher.watch("arbitrum", "0x" + i.toString(16).padStart(64, "0"));
    expect(watcher.size()).toBeLessThanOrEqual(5);
  });
});
