/**
 * Reading a recipient out of a scanned QR code.
 *
 * Typing a 42-character address by hand is the likeliest way a user of this app loses money, so
 * this exists to remove that. It is also the one place where a recipient arrives from outside
 * the user's own typing, which is why it refuses far more than it accepts.
 *
 * Two formats, both of which occur in practice:
 *
 *   0x1234…                       what Wally's own receive code encodes
 *   ethereum:0x1234…@421614       EIP-681, what most other wallets emit
 *
 * **The amount is never read, even when the code carries one.** The whole app is built on code
 * and the user picking every number and no outside source doing it — see CLAUDE.md. A QR can be
 * stale, or printed by somebody else, and a prefilled amount is a number people confirm.
 *
 * **A contract-call URI is refused rather than unwrapped.** `ethereum:<token>/transfer?address=…`
 * puts the *token contract* where the address normally goes and the real recipient in a
 * parameter. Reading the target as the recipient would send funds to a token contract, which is
 * an unrecoverable burn — so these are rejected by name rather than parsed hopefully.
 */
import { CHAINS, isAddress, type Chain } from './wallet-api.ts';

export type Scanned =
  | {
      ok: true;
      address: string;
      /** The chain the code named, or null when it named none. */
      chain: Chain | null;
      /** True when the code carried an amount, which is deliberately not used. */
      hadAmount: boolean;
    }
  | { ok: false; reason: string };

/** Chain id to our name. Derived from CHAINS so the two cannot drift. */
function chainForId(id: number): Chain | null {
  const found = (Object.keys(CHAINS) as Chain[]).find(key => CHAINS[key].id === id);
  return found ?? null;
}

export function parseScannedAddress(raw: unknown): Scanned {
  if (typeof raw !== 'string') return { ok: false, reason: 'That code could not be read.' };
  const text = raw.trim();
  if (!text) return { ok: false, reason: 'That code is empty.' };

  // A bare address, which is what Wally's own receive code contains.
  if (/^0x[\da-fA-F]{40}$/.test(text)) {
    if (!isAddress(text)) return { ok: false, reason: 'That code contains the zero address, which cannot receive funds.' };
    return { ok: true, address: text, chain: null, hadAmount: false };
  }

  const scheme = /^ethereum:/i.exec(text);
  if (!scheme) {
    // Deliberately not "find an address anywhere in the string". A recipient pulled out of
    // arbitrary text means a QR on a poster could supply one, with nothing to check it against.
    return { ok: false, reason: 'That is not a wallet address or an Ethereum payment code.' };
  }

  let body = text.slice(scheme[0].length);
  // EIP-681 allows a `pay-` prefix before the target.
  body = body.replace(/^pay-/i, '');

  const query = body.indexOf('?');
  const params = query === -1 ? '' : body.slice(query + 1);
  if (query !== -1) body = body.slice(0, query);

  // A function call puts the token contract in the target position. Refused, not unwrapped.
  if (body.includes('/')) {
    return {
      ok: false,
      reason: 'That code asks for a token transfer, which Wally cannot scan yet. Ask for a plain address code instead.',
    };
  }

  let chain: Chain | null = null;
  const at = body.indexOf('@');
  if (at !== -1) {
    const idText = body.slice(at + 1);
    body = body.slice(0, at);
    // Decimal chain ids only. EIP-681 permits 0x form, but accepting it here would mean
    // guessing at a value that decides which network money is sent on.
    if (!/^\d{1,10}$/.test(idText)) return { ok: false, reason: 'That code names a network Wally does not recognise.' };
    chain = chainForId(Number(idText));
    if (!chain) {
      return { ok: false, reason: `That code is for network ${idText}, which this wallet does not support.` };
    }
  }

  const address = body.trim();
  if (!/^0x[\da-fA-F]{40}$/.test(address)) {
    // An ENS name lands here too. There is no name resolution in the app (FEATURE-AUDIT §3.6),
    // and resolving one would mean trusting a lookup to choose a recipient.
    return { ok: false, reason: 'That code does not contain a wallet address.' };
  }
  if (!isAddress(address)) return { ok: false, reason: 'That code contains the zero address, which cannot receive funds.' };

  return {
    ok: true,
    address,
    chain,
    // Reported so the screen can say the amount was ignored, rather than silently dropping
    // something the sender may have expected to carry over.
    hadAmount: /(^|&)(value|uint256)=/i.test(params),
  };
}
