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

test('the app and the dev server parse an amount identically, across a corpus', async () => {
  // Both parsers exist because the app validates an amount before the server ever sees it. The
  // dev server's copy carries a comment saying it "must stay identical" — and nothing checked
  // that, which is how two parsers that disagree becomes a transfer passing one check and
  // failing the other.
  //
  // Compared behaviourally rather than by text, so a rewrite that preserves meaning passes and
  // a reformat that changes meaning does not.
  const { normaliseAmount: appParse } = await import('../src/services/wallet-api.ts');
  const { normaliseAmount: serverParse } = await import('../scripts/wallet-api-core.mjs');

  const corpus = [
    // The comma rule, which is the whole reason both exist.
    '0,01', '1,5', '1,250', '1.250', '1.250,50', '1,250.50',
    // Ordinary amounts.
    '0', '0.0', '1', '10.5', '0.000001', '1000000',
    // Shapes a keyboard or a paste produces.
    ' 1.5 ', '1.5\n', '.5', '5.', '1..5', '1,,5', '1.5.5', '1,5,5',
    // Separators and signs.
    '1 000', '1_000', '+1.5', '-1.5', '1e18', '0x10',
    // Empty and junk, which must agree on being junk.
    '', '   ', 'abc', '1abc', 'abc1', '∞', '１',
    // Long, to catch a different cap on either side.
    '1'.repeat(14), `${'1'.repeat(13)}.${'9'.repeat(18)}`, `0.${'9'.repeat(19)}`,
  ];

  for (const input of corpus) {
    assert.equal(
      serverParse(input),
      appParse(input),
      `the two parsers disagree on ${JSON.stringify(input)} — a transfer would pass one check and fail the other`,
    );
  }
});

test('the app and the dev server agree on which amounts are valid at all', async () => {
  // One step further than normalising: whether the amount is accepted. The app uses wei() and
  // the server ethUnits(), and a disagreement here means the app offers a Review the server
  // then refuses, or the reverse.
  // parseSendAmount, not wei(): wei() is the permissive parser that also reads history off the
  // chain, where a spam transfer can be enormous. The send field is a different question, and
  // comparing the wrong pair is what hid this for as long as it was hidden.
  const { parseSendAmount } = await import('../src/services/wallet-api.ts');
  const { ethUnits } = await import('../scripts/wallet-api-core.mjs');

  for (const input of [
    '0.01', '1,5', '1', '0.000000000000000001', '', 'abc', '1e18', '-1', '.5', '0', '0.0',
    // The boundary that was wrong: four whole digits is the most either side takes.
    '9999', '10000', '1234567890123', '1'.repeat(14),
  ]) {
    const appResult = (() => { try { return parseSendAmount(input).toString(); } catch { return 'refused'; } })();
    const serverResult = (() => { try { return ethUnits(input).toString(); } catch { return 'refused'; } })();
    assert.equal(serverResult, appResult, `disagreement on ${JSON.stringify(input)}`);
  }
});

test('a send amount is bounded where the user can see it, not a round trip later', async () => {
  const { parseSendAmount, wei, MAX_SEND_WHOLE_DIGITS } = await import('../src/services/wallet-api.ts');

  assert.equal(MAX_SEND_WHOLE_DIGITS, 4);
  assert.equal(parseSendAmount('9999'), wei('9999'), 'the largest allowed send');
  assert.equal(parseSendAmount('0.5'), wei('0.5'));
  assert.equal(parseSendAmount('0,5'), wei('0.5'), 'the comma rule still applies');

  // The message names the real limit. The old behaviour let this through and the server
  // answered with "Enter an ETH amount with up to 18 decimals", which was not the problem.
  assert.throws(() => parseSendAmount('10000'), /most is 9,999 ETH/);
  assert.throws(() => parseSendAmount('50000'), /most is 9,999 ETH/);
  assert.throws(() => parseSendAmount('0'), /greater than zero/);
  assert.throws(() => parseSendAmount('0.0'), /greater than zero/);

  // Leading zeros were never accepted by either side — toBaseUnits allows `0` or a leading
  // 1-9, and the dev server's ethUnits uses the same shape, so the two already agree.
  assert.throws(() => parseSendAmount('0009999'), /up to 18 decimals/);

  // wei() stays permissive on purpose, because it also reads history off the chain.
  assert.doesNotThrow(() => wei('1234567890123'), 'the display parser must still accept large history amounts');

  // A token's decimals are honoured here too, so this is reusable when USDt sending lands.
  assert.equal(parseSendAmount('10.5', 6, 'USDT'), 10_500_000n);
  assert.throws(() => parseSendAmount('10.5000001', 6, 'USDT'), /up to 6 decimals/);
});
