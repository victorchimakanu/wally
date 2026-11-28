import { CHAINS, type LiveTransaction } from './wallet-api.ts';

/** A saved recipient, as much of one as naming an address needs. */
export type NamedAddress = { name: string; address: string };

/** The word for each state a live transfer can be in, as a list row prints it. */
export const STATUS_WORDS: Record<LiveTransaction['status'], string> = {
  pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed', superseded: 'Never arrived', unknown: 'Unconfirmed',
};

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The saved name for an address, or null. Case-insensitive: indexers return lowercase. */
export function nameFor(address: string | undefined, recipients: readonly NamedAddress[]): string | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  return recipients.find(entry => entry.address.toLowerCase() === lower)?.name ?? null;
}

export type TransferSummary = {
  sent: boolean;
  /** "To Victor" or "From 0x6666…6666": the row's first line. */
  title: string;
  /** "Sent 0.01 ETH to Victor": the one-line form for the wallet card's tab. */
  headline: string;
  /** "Pending · Arbitrum Sepolia". */
  meta: string;
  /** Signed, with its own unit: "−0.01 ETH", "+25 USDT". */
  amount: string;
  failed: boolean;
};

/**
 * The words for one live transfer, shared by the Wallet's recent activity, its card's tab and
 * Activity, so a transfer reads the same wherever it turns up. Direction comes from whether
 * `from` is one of this wallet's addresses, as Activity has always decided it.
 */
export function liveTransferSummary(item: LiveTransaction, owned: readonly string[], recipients: readonly NamedAddress[]): TransferSummary {
  const mine = owned.map(address => address.toLowerCase());
  const sent = !!item.from && mine.includes(item.from.toLowerCase());
  const other = sent ? item.recipient : item.from;
  const name = nameFor(other, recipients);
  const who = name ?? (other ? shortAddress(other) : item.hash.slice(0, 10));
  const symbol = item.symbol ?? 'ETH';
  const amount = item.amount ?? '—';
  return {
    sent,
    title: `${sent ? 'To' : 'From'} ${who}`,
    headline: `${sent ? 'Sent' : 'Received'} ${amount} ${symbol}${name ? ` ${sent ? 'to' : 'from'} ${name}` : ''}`,
    meta: `${STATUS_WORDS[item.status]} · ${CHAINS[item.chain].name}`,
    amount: `${sent ? '−' : '+'}${amount} ${symbol}`,
    failed: item.status === 'failed' || item.status === 'superseded',
  };
}
