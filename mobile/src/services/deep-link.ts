import { parseScannedAddress } from './qr-address.ts';

/**
 * Where an incoming link should take someone, and what it is never allowed to do.
 *
 * `scheme: wally` has been registered in `app.json` since the app was built, and nothing ever
 * handled a link. `qr-address.ts` already parses EIP-681 payment URIs properly and refuses the
 * dangerous ones — so half of this was paid for and never collected.
 *
 * A link is an **untrusted input from another application**, which makes it exactly the same
 * class of thing as a scanned QR code: something that arrives claiming to describe a payment
 * and may be lying. It is therefore run through the same parser, with the same refusals — a
 * contract-call URI points at the token contract rather than the recipient, and unwrapping one
 * would burn the funds.
 *
 * Two rules this file will not bend:
 *
 * **A link fills in an address and never an amount.** `qr-address.ts` discards amounts for a
 * reason — code and the user pick every number — and a link that could prefill "10" is a link
 * that can be crafted to look like "1.0" on a small screen. The caller is told an amount was
 * present so the screen can say it was ignored.
 *
 * **A link can never send anything.** It opens Send with the recipient filled in. Every spend
 * still goes through review, the unlock and confirm, exactly as if the address were typed.
 */

export type LinkRoute =
  | { ok: true; pathname: string; params: Record<string, string> }
  /** Nothing actionable. `reason` is empty when the link was simply not for us. */
  | { ok: false; reason: string };

/** Links Wally answers that are not payments: `wally://activity` and friends. */
const SCREENS: Record<string, string> = {
  '': '/', 'wallet': '/wallet', 'activity': '/history', 'history': '/history',
  'send': '/send', 'receive': '/receive', 'chats': '/chats', 'market': '/market',
  'settings': '/settings', 'scan': '/scan',
};

/**
 * Strip our own scheme off, leaving either a screen name or a payment URI.
 *
 * `wally://ethereum:0x…` is how another app's payment link reaches us once it has been handed
 * through our scheme, so both spellings have to work.
 */
function withoutOurScheme(raw: string): string {
  const trimmed = raw.trim();
  const match = /^wally:(\/\/)?/i.exec(trimmed);
  return match ? trimmed.slice(match[0].length) : trimmed;
}

export function routeForLink(raw: unknown): LinkRoute {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: '' };
  const rest = withoutOurScheme(raw);
  if (!rest) return { ok: true, pathname: '/', params: {} };

  // A plain screen name, with any query discarded: no screen of ours takes parameters from a
  // link, and accepting them would be a way to drive the app from outside.
  const name = rest.split(/[?#/]/)[0]!.toLowerCase();
  if (Object.hasOwn(SCREENS, name) && !/^(0x|ethereum:)/i.test(rest)) {
    return { ok: true, pathname: SCREENS[name]!, params: {} };
  }

  // Anything else is treated as a payment request and held to the scanner's rules.
  const scanned = parseScannedAddress(rest);
  if (!scanned.ok) return { ok: false, reason: scanned.reason };

  return {
    ok: true,
    pathname: '/send',
    params: {
      recipient: scanned.address,
      ...(scanned.chain ? { chain: scanned.chain, scannedChain: scanned.chain } : {}),
      // Reusing the scanner's flag deliberately: the screen already explains that an amount
      // was present and deliberately not filled in, and one explanation is better than two.
      ...(scanned.hadAmount ? { scannedAmountIgnored: '1' } : {}),
    },
  };
}
