import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toChecksumAddress, checksumMatches, recipientProblem, CHECKSUM_REFUSAL } from '../src/services/address-checksum.ts';
import { parseScannedAddress } from '../src/services/qr-address.ts';
import { fileURLToPath } from 'node:url';

/**
 * EIP-55, for addresses a person supplied.
 *
 * The bug this closes: nothing checked the checksum on the way in. `isAddress` is
 * case-insensitive and must stay that way — it also validates addresses read back off the
 * chain, where indexers return lowercase — so a mistyped address travelled to the wallet
 * server and came back as **503 "Check the connection and retry"**, because
 * `ethers.getAddress`'s `bad address checksum` matched no SAFE_MESSAGE prefix. Advice about
 * the network, for one wrong character, on a retry that could never work.
 *
 * The server half is fixed in `scripts/wallet-api-core.mjs`. These cases are the client half.
 */

/** The four addresses EIP-55 itself gives as examples. */
const SPEC = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];
const GOOD = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const BROKEN = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72'; // GOOD with one letter's case flipped

test('the checksum is computed the way the spec says, not the way it looks like it should be', () => {
  // Against the spec's own vectors rather than against anything this repo produced. The hash
  // is over the lowercase hex *text* with no `0x`; getting that wrong yields a function that
  // rejects every valid address, and a self-consistent implementation would still agree with
  // itself. Only an outside vector catches it.
  for (const address of SPEC) {
    assert.equal(toChecksumAddress(address.toLowerCase()), address, `EIP-55 vector ${address}`);
    assert.ok(checksumMatches(address));
  }
});

test('a single flipped character is caught, and named as the address being wrong', () => {
  assert.equal(recipientProblem(GOOD), null);
  assert.equal(recipientProblem(BROKEN), CHECKSUM_REFUSAL);
  // The whole point of the fix: it must not read as an app or network fault.
  assert.ok(!/connection|retry|try again|service/i.test(CHECKSUM_REFUSAL), CHECKSUM_REFUSAL);
  // And it must say what was not done, like every other refusal in this app.
  assert.match(CHECKSUM_REFUSAL, /Nothing was sent/);

  // Every single-character case flip is caught, not just the one I happened to pick.
  let flips = 0, caught = 0;
  for (let i = 2; i < GOOD.length; i++) {
    const c = GOOD[i]!;
    const flipped = /[a-z]/.test(c) ? c.toUpperCase() : /[A-Z]/.test(c) ? c.toLowerCase() : null;
    if (!flipped) continue;
    flips++;
    if (!checksumMatches(GOOD.slice(0, i) + flipped + GOOD.slice(i + 1))) caught++;
  }
  // Deterministic: a lowercase address has exactly one valid capitalisation, so every
  // deviation from it is invalid. No flip can coincidentally land on a valid checksum.
  assert.ok(flips >= 12, `expected plenty of letters to flip, found ${flips}`);
  assert.equal(caught, flips, `${flips - caught} of ${flips} single-character flips went unnoticed`);
});

test('an address with no checksum to read is accepted, because that is what it means', () => {
  // EIP-55 lives in the capitalisation of the letters. All-lowercase and all-uppercase carry
  // no checksum at all, and every wallet accepts them; refusing them would reject most of what
  // indexers and other wallets emit.
  assert.equal(recipientProblem(GOOD.toLowerCase()), null);
  assert.equal(recipientProblem('0x' + GOOD.slice(2).toUpperCase()), null);
  // An address of digits only has no letters either way, and must not be treated as suspect.
  assert.ok(checksumMatches('0x' + '1'.repeat(40)));
});

test('shape failures still read as shape failures, not as checksum failures', () => {
  for (const bad of ['', '0x', '0x8ba1f109', `0x${'0'.repeat(40)}`, 'not an address']) {
    assert.equal(recipientProblem(bad), 'Enter a complete, non-zero EVM wallet address.', bad);
  }
  assert.equal(recipientProblem(`  ${GOOD}  `), null, 'surrounding space is not a defect');
});

/**
 * A QR code is not hand-typed, so a bad checksum there means the code is damaged, decoded
 * wrongly, or tampered with. Refused rather than lowercased and carried on: dropping the
 * capitalisation would discard the only evidence that it is not what it claims to be.
 */
test('a scanned code whose address fails its checksum is refused', () => {
  for (const code of [BROKEN, `ethereum:${BROKEN}@421614`]) {
    const out = parseScannedAddress(code);
    assert.equal(out.ok, false, `accepted a corrupt code: ${code}`);
    assert.match((out as { reason: string }).reason, /checksum/i);
  }
  // And the good ones still scan, in both forms.
  assert.equal(parseScannedAddress(GOOD).ok, true);
  assert.equal(parseScannedAddress(`ethereum:${GOOD}@421614`).ok, true);
  assert.equal(parseScannedAddress(GOOD.toLowerCase()).ok, true);
});

/**
 * The call sites, written as the pattern that must be **absent**.
 *
 * Twice in this audit a mutant survived because a helper was tested and its caller was not.
 * A check for the presence of `recipientProblem` would pass as soon as the identifier appeared
 * anywhere in the file; a check that the old shape-only gate is gone fails the moment someone
 * puts it back.
 */
test('nothing accepts a typed address on shape alone any more', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const send = read('screens/LiveWallet.tsx');
  assert.match(send, /recipientProblem\(/, 'the Send screen must check the checksum before quoting');
  assert.ok(!/isAddress\(recipient/.test(send),
    'the Send screen is back to the case-insensitive shape check, which cannot see a checksum');

  // The address book is the worse one: a stored bad address fails every future send, and
  // nothing on the Send screen connects that failure back to the saved entry.
  const book = read('screens/Profile.tsx');
  assert.match(book, /checksumMatches\(/, 'saving a recipient must verify the checksum');

  const qr = read('services/qr-address.ts');
  assert.match(qr, /checksumMatches\(/, 'the scanner must verify the checksum');
});
