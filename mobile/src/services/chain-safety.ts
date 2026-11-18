/**
 * The address is right. The chain is not.
 *
 * Every EVM address is syntactically valid on every EVM chain, so nothing in a send path will
 * ever refuse one for being on the wrong network. That is what makes this a money-loss route
 * rather than an inconvenience: the transfer succeeds, the explorer shows it confirmed, and
 * the funds are at an address on a chain where nobody can reach them.
 *
 * **Wally demonstrates the hazard on itself.** Its Arbitrum account is an ERC-4337 smart
 * account whose address comes from the account factory, not from the key, so it need not
 * equal the Ethereum EOA — which is why `/v1/history` takes an address per chain. A contract
 * exists only on the chain it was deployed to. Send to a smart-account address on the other
 * network and you have sent to an address nobody holds the key for.
 *
 * An EOA usually *is* reachable on both, and this does not claim otherwise. It cannot tell
 * which kind an address is without asking a node, and a warning that waits on the network is
 * a warning that does not appear. So it says what it actually knows — *you have only ever
 * used this one somewhere else* — and leaves the decision with the person, who knows who gave
 * them the address.
 *
 * ## Where the knowledge comes from
 *
 * Saved recipients already carry a `network`, and have since the address book was built. That
 * field was stored and never read for this. History supplies the rest: a transfer records the
 * chain it happened on.
 *
 * Unlike `address-safety.ts`, history **is** trusted here, and the difference is worth stating
 * because the two look similar. There, a poisoned entry in history is the attack, so only
 * addresses the user deliberately saved count. Here the question is not "is this address
 * trustworthy" but "which chains have I seen it on" — and an attacker who adds a chain to that
 * set makes this warn *more*, never less. The failure direction is safe, so the wider source
 * is the better one.
 */
import type { Chain } from './wallet-api.ts';

/** One observation: this address was used on this chain. */
export type ChainUse = { address: string; chain: Chain };

export const CHAIN_LABELS: Record<Chain, string> = { arbitrum: 'Arbitrum', ethereum: 'Ethereum' };

const normalise = (address: string) => address.trim().toLowerCase();

/**
 * Read a saved recipient's network into a chain.
 *
 * The address book stores `'Arbitrum' | 'Ethereum'` while everything else speaks
 * `'arbitrum' | 'ethereum'`. Returns null for anything else rather than guessing: a stored
 * value this does not recognise must not become a confident claim about where an address has
 * been used.
 */
export function chainOfNetwork(network: string): Chain | null {
  const lowered = network.trim().toLowerCase();
  return lowered === 'arbitrum' || lowered === 'ethereum' ? lowered : null;
}

/**
 * Every chain this exact address has been seen on, in a stable order.
 *
 * Exact, full-string comparison. A truncated or lookalike match is `address-safety.ts`'s
 * question and answering it here would conflate two different warnings.
 */
export function chainsUsed(address: string, uses: readonly ChainUse[]): Chain[] {
  const target = normalise(address);
  if (!target) return [];
  const found = new Set<Chain>();
  for (const use of uses) if (normalise(use.address) === target) found.add(use.chain);
  return [...found].sort();
}

/**
 * What to say when someone is about to send somewhere this address has never been.
 *
 * Null — say nothing — in three cases, and each is deliberate:
 *
 * - **This address has been used on this chain.** Ordinary; nothing to warn about.
 * - **This address has never been seen anywhere.** Also silent, and this is the one worth
 *   defending. A first payment to a new person is the most common thing a wallet does. A
 *   warning on every one of them is a warning that gets dismissed without reading, and it
 *   would be dismissed on the occasion that mattered too. `address-safety.ts` already covers
 *   the dangerous version of an unfamiliar address.
 * - **No address, or a blank one.** Nothing to say yet.
 *
 * The wording names the mechanism rather than pronouncing a verdict, because this cannot know
 * whether the address is an EOA that works everywhere or a contract that does not exist here.
 * Stating the uncertainty is the honest version and is also the one that makes someone check.
 */
export function crossChainWarning(input: {
  address: string;
  chain: Chain;
  uses: readonly ChainUse[];
}): string | null {
  const seen = chainsUsed(input.address, input.uses);
  if (!seen.length || seen.includes(input.chain)) return null;

  const elsewhere = seen.map(chain => CHAIN_LABELS[chain]).join(' and ');
  const here = CHAIN_LABELS[input.chain];
  return (
    `You have only used this address on ${elsewhere}, and this transfer is on ${here}. ` +
    `The same address is not always the same wallet on another network — a smart account ` +
    `exists only where it was created, and anything sent to it here could be unreachable. ` +
    `Check with whoever gave you the address that it works on ${here}.`
  );
}
