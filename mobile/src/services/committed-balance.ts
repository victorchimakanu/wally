/**
 * Money that is already spoken for.
 *
 * `eth_getBalance` answers for the latest *block*. A transfer that has been broadcast and not
 * yet mined is not in a block, so it is not deducted — the node reports the full balance while
 * some of it is already committed to a transaction that cannot be recalled.
 *
 * The Send screen prints that number under the word **"Available"**, which is untrue for as
 * long as anything is in flight. Someone who sends twice in quick succession is shown a figure
 * that includes money they have already spent, types an amount against it, and gets a refusal
 * from the node — or, worse, a second transfer that strands the first by consuming the nonce.
 *
 * ## What counts
 *
 * Only transfers **out** of this wallet, on **this chain**, that have not settled. Confirmed
 * ones are already reflected in the node's answer; failed and superseded ones never will be.
 *
 * Fees are always native, whatever the transfer moved. So a pending USDt transfer commits USDt
 * by its amount *and* ETH by its fee, and asking for the native total has to pick up fees from
 * token transfers too. Getting this backwards is the kind of error that looks right: the USDt
 * figure would be correct and the ETH one quietly short.
 *
 * ## Which way it is allowed to be wrong
 *
 * Always toward showing less. A transfer that has in fact just been mined but is still listed
 * as pending gets deducted twice — once by the node, once here — so the figure is low until
 * the next refresh. That is a number that is briefly pessimistic, against the alternative of
 * one that invites a send which cannot succeed.
 *
 * An amount this cannot parse is the sharp edge. Skipping it would *understate* what is
 * committed and therefore **overstate** what is available, which is the one direction that
 * must not happen silently. So it is reported as `uncertain`, and the caller says it does not
 * know rather than printing a figure it cannot stand behind.
 */
import { toBaseUnits, type Chain, type LiveTransaction } from './wallet-api.ts';

/** The native coin on both supported chains. `symbol` absent on a record means this. */
export const NATIVE_SYMBOL = 'ETH';

export type Committed = {
  /** Base units already committed, at the asset's own scale. */
  base: bigint;
  /**
   * True when something in flight could not be read, so `base` is a floor rather than a total.
   * The caller must not present a figure derived from it as exact.
   */
  uncertain: boolean;
};

/** Settled one way or the other: the node's balance already accounts for it, or it never will. */
function inFlight(status: LiveTransaction['status']): boolean {
  // 'unknown' counts as in flight: a submission whose fate nobody has established yet may
  // still land, and assuming it will not is assuming money back that may be gone.
  return status === 'pending' || status === 'unknown';
}

const normalise = (address: string) => address.trim().toLowerCase();

/**
 * What pending transfers have already committed of one asset, on one chain.
 *
 * `decimals` is the asset's own scale and is passed rather than assumed, because running a
 * 6-decimal token through the 18-decimal one is wrong by a factor of a million million and
 * looks perfectly ordinary on the way past.
 */
export function committedBase(input: {
  chain: Chain;
  symbol: string;
  decimals: number;
  /** Every address this wallet holds. A transfer out of one of these is a spend. */
  owned: readonly string[];
  history: readonly LiveTransaction[];
  /** The native coin's scale, for fees. Always 18 on an EVM chain. */
  nativeDecimals?: number;
}): Committed {
  const owned = new Set(input.owned.map(normalise));
  const wantNative = input.symbol.toUpperCase() === NATIVE_SYMBOL;
  const nativeDecimals = input.nativeDecimals ?? 18;

  let base = 0n;
  let uncertain = false;

  for (const item of input.history) {
    if (item.chain !== input.chain) continue;
    if (!item.from || !owned.has(normalise(item.from))) continue;
    if (!inFlight(item.status)) continue;

    // Absent `symbol` means the native coin — that is how every record written before USDt
    // existed reads, so absence has to keep meaning ETH rather than becoming an error.
    const moved = (item.symbol ?? NATIVE_SYMBOL).toUpperCase();

    if (moved === input.symbol.toUpperCase()) {
      if (item.amount === undefined) uncertain = true;
      else {
        try { base += toBaseUnits(item.amount, input.decimals, input.symbol); }
        catch { uncertain = true; }
      }
    }

    // Fees are native whatever moved, so a pending token transfer still commits ETH.
    if (wantNative) {
      if (item.fee === undefined) uncertain = true;
      else {
        try { base += toBaseUnits(item.fee, nativeDecimals, NATIVE_SYMBOL); }
        catch { uncertain = true; }
      }
    }
  }

  return { base, uncertain };
}

export type Available = {
  /** What can actually be sent, or null when it cannot be stated honestly. */
  base: bigint | null;
  /** What is held back, for saying so. */
  committed: bigint;
  /** Whether anything is in flight at all. */
  pending: boolean;
};

/**
 * The balance minus what is already committed.
 *
 * Null when the committed total is uncertain, or when there is no balance to start from. A
 * screen that cannot compute this must say so — printing the raw balance under the word
 * "Available" is the behaviour this exists to end.
 *
 * Floored at zero. A negative available balance is not a thing anyone can act on, and the
 * arithmetic can go negative legitimately: a transfer listed as pending that has already been
 * mined is deducted by the node and again here.
 */
export function availableBase(balanceBase: bigint | null, committed: Committed): Available {
  const pending = committed.base > 0n || committed.uncertain;
  if (balanceBase === null || committed.uncertain) {
    return { base: null, committed: committed.base, pending };
  }
  const left = balanceBase - committed.base;
  return { base: left > 0n ? left : 0n, committed: committed.base, pending };
}
