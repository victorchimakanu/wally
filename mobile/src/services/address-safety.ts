/**
 * Telling a recipient you chose from one you were shown.
 *
 * The attack this exists for is address poisoning. Someone sends you a dust transfer from an
 * address generated to share the first and last characters of one you actually use. It lands
 * in your history, the app renders it truncated, and the truncation is identical to the real
 * one. Next time you pay that person you copy the attacker's address out of your own history.
 *
 * This is not theoretical and it is not exotic — it is among the most common ways people lose
 * money in a wallet, precisely because every wallet truncates addresses and the user is doing
 * exactly what the interface invited them to do.
 *
 * The screens here truncate as `slice(0, 6)…slice(-4)`: four leading hex characters and four
 * trailing. Matching eight hex characters is around 32 bits, which a vanity-address generator
 * produces in seconds. So the display cannot be trusted to distinguish two addresses, and the
 * comparison has to happen on the full value.
 */

/** The narrowest truncation any screen uses, and therefore the easiest to collide with. */
const LEAD = 6;  // "0x" + 4 hex
const TAIL = 4;

export type AddressTrust =
  /** Exactly an address the user has deliberately used before. */
  | { kind: 'known'; label?: string }
  /**
   * Looks the same as one of those in the interface, but is not it. This is the dangerous
   * case and the only one that deserves to interrupt someone.
   */
  | { kind: 'lookalike'; resembles: string; label?: string }
  /** Not seen before, and not pretending to be anything. Ordinary. */
  | { kind: 'new' };

const normalise = (a: string) => a.trim().toLowerCase();

/** How an address appears once a screen has truncated it. */
export function displayForm(address: string): string {
  const a = normalise(address);
  return a.length <= LEAD + TAIL ? a : `${a.slice(0, LEAD)}…${a.slice(-TAIL)}`;
}

/**
 * Compare a candidate against the addresses a user has actually chosen before — their address
 * book and anything they have sent to. **Addresses that merely appeared in history must not be
 * passed as known**, because that is where a poisoned entry lives; treating it as trusted
 * would invert the whole point of this function.
 */
export function addressTrust(
  candidate: string,
  known: readonly { address: string; label?: string }[],
): AddressTrust {
  const target = normalise(candidate);
  if (!target) return { kind: 'new' };

  for (const entry of known) {
    if (normalise(entry.address) === target) {
      return entry.label === undefined ? { kind: 'known' } : { kind: 'known', label: entry.label };
    }
  }

  // Nothing matched exactly. Does anything match once the screen has shortened it?
  const shown = displayForm(target);
  for (const entry of known) {
    if (displayForm(entry.address) === shown) {
      return entry.label === undefined
        ? { kind: 'lookalike', resembles: entry.address }
        : { kind: 'lookalike', resembles: entry.address, label: entry.label };
    }
  }
  return { kind: 'new' };
}

/**
 * What to put in front of someone, in their words rather than ours.
 *
 * The lookalike wording names the mechanism — that it *looks* like one they know but is a
 * different address — because "unrecognised address" would be read as routine and dismissed.
 * It also refuses to say which is correct, since this function cannot know.
 */
export function trustWarning(trust: AddressTrust): string | null {
  if (trust.kind === 'known' || trust.kind === 'new') return null;
  const who = trust.label ? `“${trust.label}”` : 'one you have used before';
  return (
    `This address looks like ${who} in the list, but it is a different address. ` +
    `Scammers send small payments from near-identical addresses so they get copied by mistake. ` +
    `Check every character against where you got it from before sending.`
  );
}
