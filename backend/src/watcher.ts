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
  /**
   * The chain's latest block number.
   *
   * Required rather than optional, deliberately. An optional head would mean "no depth check
   * unless you remember to pass one", and forgetting is exactly how this service came to call
   * a one-block receipt final. Every construction site has to decide.
   */
  fetchHead(chain: Chain): Promise<number>;
  now?: () => number;
  /** Beyond this, a watch is dropped whatever its state. */
  ttlMs?: number;
  /** A ceiling, so the list cannot become a memory leak someone else controls. */
  maxWatches?: number;
};

export const DEFAULT_TTL_MS = 30 * 60_000;
export const DEFAULT_MAX_WATCHES = 500;

/**
 * How deep a receipt must be before this calls a transfer confirmed.
 *
 * **A receipt is not finality.** A chain reorganisation can remove a block that already had
 * one. The loopback wallet server learned this on 5 November 2026 — until then it said
 * "confirmed" the instant a receipt appeared, so Wally could tell someone their money had
 * arrived and never correct itself when it had not — and it has required depth ever since.
 * This service, which is what will feed push notifications, did not. The same bug, in the
 * half nobody had looked at.
 *
 * The numbers match `CONFIRMATIONS` in `mobile/scripts/wallet-api-core.mjs` and for the same
 * reasons: Ethereum Sepolia reorgs a block or two routinely, so three; Arbitrum's sequencer
 * makes single-block reorgs the realistic case, so two — still more than one, because the
 * point is not to trust the first answer.
 *
 * A push that says "your transfer confirmed" cannot be taken back, which is why this matters
 * more here than anywhere else it could have been missed.
 */
export const CONFIRMATIONS: Record<Chain, number> = { ethereum: 3, arbitrum: 2 };

/** Blocks required on this chain, defaulting to the stricter number for anything unknown. */
export function confirmationsFor(chain: Chain): number {
  return CONFIRMATIONS[chain] ?? 3;
}

/**
 * Whether a mined transfer is deep enough to be called confirmed.
 *
 * The block holding it counts as the first confirmation, so a receipt in the head block has
 * depth 1. Anything unknown — no block number, no head, a node that would not answer — is
 * **not** deep enough. Not being able to ask is not the same as "yes", and the failure this
 * guards against is saying yes too early.
 */
export function deepEnough(chain: Chain, blockNumber: number | undefined, head: number | undefined): boolean {
  if (blockNumber === undefined || head === undefined) return false;
  if (!Number.isFinite(blockNumber) || !Number.isFinite(head)) return false;
  return head - blockNumber + 1 >= confirmationsFor(chain);
}

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
  fetchHead,
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
     *
     * A successful receipt is held at pending until it is `CONFIRMATIONS` deep. The head is
     * read once per chain per round rather than once per watch: fifty transfers settling in
     * the same block are one question about the chain, not fifty.
     *
     * **A failure is reported immediately, without waiting for depth.** A reorg cannot turn a
     * failure into a success without also changing the hash, so there is nothing to be wrong
     * about — and making someone wait three blocks to learn their transfer did not go through
     * is a cost with no safety behind it.
     */
    async tick(): Promise<void> {
      const at = now();
      drop(at);
      const open = [...watches.values()].filter(watch => !isSettled(watch.state));

      const reads = await Promise.all(open.map(async watch => {
        try { return { watch, read: stateFromReceipt(await fetchReceipt(watch.chain, watch.hash)) }; }
        catch { return { watch, read: null }; }
      }));

      // Only chains with something that looks confirmed need a head.
      const heads = new Map<Chain, number>();
      await Promise.all([...new Set(reads.filter(entry => entry.read?.state === "confirmed").map(entry => entry.watch.chain))]
        .map(async chain => {
          // Left absent on failure, which `deepEnough` reads as not deep enough. The transfer
          // stays pending and the next round asks again.
          try { heads.set(chain, await fetchHead(chain)); } catch { /* not knowing is not yes */ }
        }));

      for (const { watch, read } of reads) {
        watch.checkedAt = now();
        if (!read) continue;
        // Recorded even while still pending: it is on chain, it is simply not safe to say so.
        if (read.blockNumber !== undefined) watch.blockNumber = read.blockNumber;
        watch.state = read.state === "confirmed" && !deepEnough(watch.chain, read.blockNumber, heads.get(watch.chain))
          ? "pending"
          : read.state;
      }
    },

    /** Marks everything past its time as expired rather than deleting silently. Testing aid. */
    size(): number { drop(now()); return watches.size; },
    open(): number { drop(now()); return [...watches.values()].filter(w => !isSettled(w.state)).length; },
  };
}

export type Watcher = ReturnType<typeof createWatcher>;
