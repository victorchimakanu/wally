import test from 'node:test';
import assert from 'node:assert/strict';
import { wei, normaliseAmount, maxSendable } from '../src/services/wallet-api.ts';

/**
 * Amount parsing decides how much money moves, so every case here is written around the
 * direction of the mistake rather than around tidiness.
 */

test('a lone comma is a decimal point, because the other reading loses money', () => {
  assert.equal(wei('0,01'), wei('0.01'));
  assert.equal(wei('1,5'), 1_500_000_000_000_000_000n);

  // The ambiguous one. 1,250 could be 1250 (grouping) or 1.250 (decimal comma).
  // Reading it as a decimal means someone who meant 1250 sends 1.25 — wrong, recoverable.
  // Reading it as grouping means someone who meant 1.250 sends 1250 — wrong, gone.
  assert.equal(wei('1,250'), wei('1.250'), 'must take the reading that risks sending less');
});

test('anything more ambiguous than one comma is refused, not guessed', () => {
  for (const bad of ['1.250,50', '1,250.50', '1,2,3', '1,,5']) {
    assert.throws(() => wei(bad), /18 decimals/, `must refuse: ${bad}`);
  }
});

test('normaliseAmount leaves unambiguous input exactly as it was', () => {
  for (const same of ['0', '1', '0.01', '1234.5678', '', 'nonsense']) {
    assert.equal(normaliseAmount(same), same);
  }
});

test('existing amounts still parse exactly as before', () => {
  assert.equal(wei('0'), 0n);
  assert.equal(wei('1'), 10n ** 18n);
  assert.equal(wei('0.000000000000000001'), 1n);
  assert.throws(() => wei('-1'), /18 decimals/);
  assert.throws(() => wei('1e5'), /18 decimals/);
  assert.throws(() => wei('99999999999999'), /18 decimals/);  // 14 digits, over the cap
});

test('maxSendable leaves room for the fee, and leans high', () => {
  const gwei = 1_000_000_000n;
  const oneEth = 10n ** 18n;

  // 21000 gas at 1 gwei = 21000 gwei, plus a 20% buffer.
  const fee = 21_000n * gwei;
  assert.equal(maxSendable(oneEth, gwei), oneEth - (fee + fee / 5n));

  // The result must actually be sendable: amount + fee has to fit inside the balance.
  const max = maxSendable(oneEth, gwei);
  assert.ok(max + fee < oneEth, 'the fee must still fit after sending the maximum');
});

test('maxSendable returns zero rather than a negative when the fee exceeds the balance', () => {
  const gwei = 1_000_000_000n;
  // A dust balance that cannot cover 21000 gas.
  assert.equal(maxSendable(1000n, gwei), 0n);
  assert.equal(maxSendable(0n, gwei), 0n);
  // Degenerate inputs must not produce a spendable number.
  assert.equal(maxSendable(10n ** 18n, 0n), 0n);
  assert.equal(maxSendable(10n ** 18n, gwei, 0n), 0n);
  assert.equal(maxSendable(-5n, gwei), 0n);
});

test('a bigger buffer always leaves less, never more', () => {
  const gwei = 2_000_000_000n, bal = 10n ** 18n;
  assert.ok(maxSendable(bal, gwei, 21_000n, 50n) < maxSendable(bal, gwei, 21_000n, 10n));
});
