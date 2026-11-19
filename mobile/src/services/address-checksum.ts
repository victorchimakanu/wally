/**
 * EIP-55, for addresses a **person** supplied.
 *
 * ## Why this is a second function and not a stricter `isAddress`
 *
 * The same split as `wei` and `parseSendAmount`, for the same reason. `isAddress` in
 * `wallet-api.ts` is `/^0x[\da-f]{40}$/i` — case insensitive, so blind to a checksum — and it
 * has to stay that way, because it is also applied to addresses read back **off the chain**:
 * balance records (`wallet-api.ts:284`), `parseQuote` (`:306`), the history query (`:384`).
 * Indexers return lowercase. Tightening that function would reject real data.
 *
 * So: one permissive test for what the chain says, one strict test for what a person typed.
 *
 * ## What this was costing
 *
 * Nothing checked the checksum on the way in. The address went to the wallet server, whose own
 * `validAddress` is the same case-insensitive regex, and only `ethers.getAddress` deep inside
 * `quote()` noticed — by throwing `bad address checksum`, which matched no SAFE_MESSAGE prefix,
 * so the server answered **503 "Check the connection and retry."** A mistyped address reported
 * as a network fault, on a retry that could never work.
 *
 * That half is fixed in `scripts/wallet-api-core.mjs`. This is the other half, and it buys two
 * things the server fix cannot:
 *
 *  - the refusal arrives **before a network round trip**, next to the field, which is where a
 *    typo is actually fixed;
 *  - the **address book** can refuse to store one. `Profile.tsx` saved on a bare shape check,
 *    so a bad-checksum address could sit under a name and fail every future send, with nothing
 *    anywhere connecting the failure to the stored entry.
 *
 * ## What a checksum can and cannot do
 *
 * EIP-55 encodes a hash of the address in the **capitalisation** of its letters. So it can only
 * speak when there are mixed-case letters to read: an all-lowercase or all-uppercase address
 * carries no checksum and is accepted, exactly as every wallet accepts it. It catches a
 * corrupted or mistyped copy of a checksummed address, which is the common case, and it cannot
 * tell you an address is the *wrong person's*. That is what the poisoning check in
 * `address-safety.ts` is for, and the two are not substitutes.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { isAddress } from './wallet-api.ts';

const SHAPE = /^0x[\da-fA-F]{40}$/;

/** True when the string carries a checksum at all — i.e. has letters in both cases. */
function carriesChecksum(address: string): boolean {
  const body = address.slice(2);
  return /[a-f]/.test(body) && /[A-F]/.test(body);
}

/**
 * The EIP-55 capitalisation of an address.
 *
 * Hashed as the **lowercase hex text without `0x`**, per the spec. Getting that wrong produces
 * a function that rejects every valid address, which is at least loud.
 */
export function toChecksumAddress(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const digest = keccak_256(new TextEncoder().encode(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    // Each hex character of the address is decided by the matching nibble of the digest.
    const nibble = i % 2 === 0 ? digest[i >> 1]! >> 4 : digest[i >> 1]! & 0xf;
    const char = lower[i]!;
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

/** Whether a mixed-case address agrees with its own checksum. Lowercase or uppercase: true. */
export function checksumMatches(address: string): boolean {
  if (!SHAPE.test(address)) return false;
  if (!carriesChecksum(address)) return true;
  return toChecksumAddress(address) === address;
}

/**
 * The message a person reads when their address does not survive its own checksum.
 *
 * It names the mechanism rather than saying "invalid", because what the reader needs to know is
 * that the *address* is wrong and not the app — the whole failure of the old behaviour was
 * sending them to check their connection. It ends the way every refusal in this app ends: by
 * saying what was not done.
 */
export const CHECKSUM_REFUSAL =
  'That address has a character wrong. Its capitalisation is a checksum and it does not match, '
  + 'so this is not a real address. Copy it again from where you got it. Nothing was sent.';

/** What to say for a recipient a person typed, or null when there is nothing wrong with it. */
export function recipientProblem(value: string): string | null {
  const address = value.trim();
  if (!isAddress(address)) return 'Enter a complete, non-zero EVM wallet address.';
  return checksumMatches(address) ? null : CHECKSUM_REFUSAL;
}
