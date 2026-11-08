import type { Chain } from "./config.js";

/**
 * Watching a submitted transfer until the chain decides, so a phone does not have to.
 *
 * `README.md` has named this as the one thing a phone genuinely cannot do for itself: it
 * sleeps mid-confirmation. A transfer is submitted, the screen locks, and nothing checks the
 * receipt until somebody opens the app again. Today that means Activity shows "pending" for as
 * long as the phone is in a pocket, and on the public Sepolia nodes — measured at 11 to 12
 * seconds for a single call on 8 November — the check when it finally happens is slow too.
 *
 * **What this deliberately is not.** It does not notify anybody. Push needs a device token,
 * which needs a development build, which has never been made. When that exists this is what
 * feeds it; until then it makes the answer ready before the app asks, which on those nodes is
 * the difference between an instant Activity screen and a twelve-second one.
 *
 * **On holding state at all.** This service holds no keys, no seeds and no personal data, and
 * a watch list is the first state it has ever kept — so it is kept as narrowly as possible.
 * Transaction hashes are public chain data. The list lives in memory, never touches disk, is
 * bounded, and expires: a hash nobody has asked about for `ttlMs` is dropped whatever its
 * state. Restarting the process forgets everything, which is correct rather than a limitation.
 */

export type WatchState = "pending" | "confirmed" | "failed" | "expired";

export type Watch = {
  chain: Chain;
  hash: string;
  state: WatchState;
  /** When this hash was first watched. */
  since: number;
  /** When the chain was last asked. 0 means never. */
  checkedAt: number;
  /** Present once it is in a block. */
  blockNumber?: number;
};

/** A receipt as the node returns it, or null while the transaction is not yet in a block. */
export type Receipt = { status?: string; blockNumber?: string } | null;

export type WatcherDeps = {
  fetchReceipt(chain: Chain, hash: string): Promise<Receipt>;
  now?: () => number;
  /** Beyond this, a watch is dropped whatever its state. */
  ttlMs?: number;
  /** A ceiling, so the list cannot become a memory leak someone else controls. */
  maxWatches?: number;
};

export const DEFAULT_TTL_MS = 30 * 60_000;
export const DEFAULT_MAX_WATCHES = 500;

const SETTLED: WatchState[] = ["confirmed", "failed", "expired"];
export const isSettled = (state: WatchState): boolean => SETTLED.includes(state);

/**
 * Read a receipt into a state.
 *
 * A **null receipt is not a failure** — it is the ordinary answer for a transaction that has
 * been accepted and is not yet in a block, and treating it as failure would tell someone their
 * money did not move when it is about to. Anything the node returns that is not recognisably a
 * receipt is also pending, for the same reason: not knowing is not the same as "no".
 */
export function stateFromReceipt(receipt: Receipt): { state: WatchState; blockNumber?: number } {
  if (!receipt || typeof receipt !== "object") return { state: "pending" };
  const status = typeof receipt.status === "string" ? receipt.status.toLowerCase() : "";
  const block = typeof receipt.blockNumber === "string" && /^0x[\da-f]+$/i.test(receipt.blockNumber)
    ? Number(BigInt(receipt.blockNumber))
    : undefined;
  if (status === "0x1") return { state: "confirmed", ...(block === undefined ? {} : { blockNumber: block }) };
  if (status === "0x0") return { state: "failed", ...(block === undefined ? {} : { blockNumber: block }) };
  return { state: "pending" };
}

export function createWatcher({
  fetchReceipt,
  now = Date.now,
  ttlMs = DEFAULT_TTL_MS,
  maxWatches = DEFAULT_MAX_WATCHES,
}: WatcherDeps) {
  const watches = new Map<string, Watch>();
  const keyOf = (chain: Chain, hash: string) => `${chain}:${hash.toLowerCase()}`;

  function drop(at: number): void {
    for (const [key, watch] of watches) if (at - watch.since > ttlMs) watches.delete(key);
  }

  return {
    /**
     * Start watching, or return the watch already running.
     *
     * Idempotent on purpose: an app that retries, or two phones restored from the same seed,
     * must not multiply the work. When the list is full the oldest settled watch is evicted
     * before an unsettled one, because a settled answer has already been useful.
     */
    watch(chain: Chain, hash: string): Watch {
      const at = now();
      drop(at);
      const key = keyOf(chain, hash);
      const existing = watches.get(key);
      if (existing) return existing;

      if (watches.size >= maxWatches) {
        const settled = [...watches.entries()].filter(([, w]) => isSettled(w.state)).sort((a, b) => a[1].since - b[1].since)[0];
        const oldest = settled ?? [...watches.entries()].sort((a, b) => a[1].since - b[1].since)[0];
        if (oldest) watches.delete(oldest[0]);
      }

      const created: Watch = { chain, hash, state: "pending", since: at, checkedAt: 0 };
      watches.set(key, created);
      return created;
    },

    get(chain: Chain, hash: string): Watch | null {
      drop(now());
      return watches.get(keyOf(chain, hash)) ?? null;
    },

    /**
     * One polling round: ask the chain about everything still unsettled.
     *
     * Failures are swallowed per watch. A node that is down leaves a transfer pending, which is
     * true, rather than marking it failed, which would not be — and the next round asks again.
     */
    async tick(): Promise<void> {
      const at = now();
      drop(at);
      const open = [...watches.values()].filter(watch => !isSettled(watch.state));
      await Promise.all(open.map(async watch => {
        try {
          const read = stateFromReceipt(await fetchReceipt(watch.chain, watch.hash));
          watch.checkedAt = now();
          watch.state = read.state;
          if (read.blockNumber !== undefined) watch.blockNumber = read.blockNumber;
        } catch {
          watch.checkedAt = now();
        }
      }));
    },

    /** Marks everything past its time as expired rather than deleting silently. Testing aid. */
    size(): number { drop(now()); return watches.size; },
    open(): number { drop(now()); return [...watches.values()].filter(w => !isSettled(w.state)).length; },
  };
}

export type Watcher = ReturnType<typeof createWatcher>;
