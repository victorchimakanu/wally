import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeTransfer, decodeTransfer, tokenUnits, TRANSFER_SELECTOR } from '../scripts/wallet-api-core.mjs';

/**
 * For a token transfer the recipient and the amount are not in the transaction's `to` and
 * `value` — `to` is the token contract, `value` is zero, and both of the things a user actually
 * approved live inside the calldata. Every check the confirm path has made before signing a
 * native transfer has to be made *inside* that data, or it is checking the wrong fields and
 * passing.
 *
 * So these are about the codec being exactly right in both directions.
 */

const R = '0x000000000000000000000000000000000000dEaD';
const OTHER = '0x' + 'b'.repeat(40);

test('a transfer encodes to the standard selector and two padded words', () => {
  const data = encodeTransfer(R, 25_000_000n);
  assert.equal(data.slice(0, 10), TRANSFER_SELECTOR);
  assert.equal(data.length, 2 + 8 + 64 + 64, 'selector plus two 32-byte words');
  assert.ok(data.toLowerCase().includes(R.slice(2).toLowerCase()));
});

test('it round-trips, which is what the pre-broadcast check depends on', () => {
  for (const value of [1n, 25_000_000n, 9999n * 10n ** 6n, 2n ** 255n]) {
    const back = decodeTransfer(encodeTransfer(R, value));
    assert.equal(back.recipient.toLowerCase(), R.toLowerCase());
    assert.equal(back.value, value);
  }
});

test('decoding refuses anything that is not a transfer', () => {
  assert.equal(decodeTransfer('0x'), null);
  assert.equal(decodeTransfer(''), null);
  assert.equal(decodeTransfer(null), null);
  // approve(address,uint256) — right shape, wrong call. Approving a spender is not sending.
  assert.equal(decodeTransfer('0x095ea7b3' + '0'.repeat(128)), null);
  // Right selector, truncated arguments.
  assert.equal(decodeTransfer(TRANSFER_SELECTOR + '0'.repeat(100)), null);
  // Dirty high bytes in the address word: not an address, so not a transfer we will sign.
  assert.equal(decodeTransfer(TRANSFER_SELECTOR + 'f'.repeat(24) + 'a'.repeat(40) + '0'.repeat(64)), null);
  // The zero address — validAddress refuses it, so a burn cannot be dressed as a transfer.
  assert.equal(decodeTransfer(TRANSFER_SELECTOR + '0'.repeat(64) + '1'.repeat(64)), null);
});

test('a tampered recipient is visible after decoding, not before', () => {
  // The point of decoding rather than string-comparing: both of these are well-formed
  // calldata of identical length, and only reading them apart tells them apart.
  const mine = encodeTransfer(R, 25_000_000n);
  const theirs = encodeTransfer(OTHER, 25_000_000n);
  assert.equal(mine.length, theirs.length);
  assert.notEqual(decodeTransfer(mine).recipient.toLowerCase(), decodeTransfer(theirs).recipient.toLowerCase());
});

test('a tampered amount is visible the same way', () => {
  const approved = encodeTransfer(R, 25_000_000n);
  const inflated = encodeTransfer(R, 25_000_000_000n);
  assert.equal(approved.length, inflated.length);
  assert.equal(decodeTransfer(inflated).value, 25_000_000_000n);
});

test('encoding refuses what must never be encoded', () => {
  assert.throws(() => encodeTransfer('not-an-address', 1n), /recipient address/);
  assert.throws(() => encodeTransfer('0x' + '0'.repeat(40), 1n), /recipient address/, 'the zero address');
  assert.throws(() => encodeTransfer(R, 0n), /must be positive/);
  assert.throws(() => encodeTransfer(R, -1n), /must be positive/);
  assert.throws(() => encodeTransfer(R, 2n ** 256n), /larger than this token/, 'padding would truncate it');
});

test('a token amount uses the token scale, never ETH\'s', () => {
  // The million-million bug: 25 USDt is 25_000_000, not 25 * 10^18.
  assert.equal(tokenUnits('25', 6, 'USDT'), 25_000_000n);
  assert.equal(tokenUnits('0.000001', 6, 'USDT'), 1n);
  assert.equal(tokenUnits('25', 18, 'ETH'), 25n * 10n ** 18n);
  assert.notEqual(tokenUnits('25', 6, 'USDT'), tokenUnits('25', 18, 'ETH'));
});

test('a token amount is bounded the way the typed ETH amount is', () => {
  assert.throws(() => tokenUnits('50000', 6, 'USDT'), /The most is 9,999 USDT/);
  assert.throws(() => tokenUnits('1.1234567', 6, 'USDT'), /up to 6 decimals/);
  assert.throws(() => tokenUnits('0', 6, 'USDT'), /must be positive/);
  assert.throws(() => tokenUnits('-1', 6, 'USDT'), /up to 6 decimals/);
  assert.throws(() => tokenUnits('abc', 6, 'USDT'), /up to 6 decimals/);
  assert.equal(tokenUnits('9999', 6, 'USDT'), 9999n * 10n ** 6n, 'the bound itself is allowed');
});

test('a comma decimal is read the same way as everywhere else', () => {
  // normaliseAmount's rule: a lone comma is a decimal point, because reading 1,250 as 1250
  // when the user meant 1.250 loses their money and the other way round merely annoys them.
  assert.equal(tokenUnits('1,5', 6, 'USDT'), 1_500_000n);
});
