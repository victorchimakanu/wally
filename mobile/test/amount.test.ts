import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wei, normaliseAmount, maxSendable, amountForInput, parseSendAmount } from '../src/services/wallet-api.ts';

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
/**
 * The Max button has to write a number the amount field can read back.
 *
 * It did not. `fillMax` filled the field with `formatUnits(...)`, which groups thousands
 * through `toLocaleString('en-US')`, into a field whose parser reads a lone comma as a decimal
 * point. The comma rule is deliberate and right — see `normaliseAmount` — so the bug is not
 * there; it is that the display formatter was used to produce machine input.
 *
 * The result, for every balance between 1,000 and the 9,999 ceiling:
 *
 *   1,000    -> filled "1,000"     -> parsed as 1 USDT        (1000x too small, silently)
 *   2,500    -> filled "2,500"     -> parsed as 2.5 USDT      (1000x too small, silently)
 *   1,234.56 -> filled "1,234.56"  -> refused; the button does nothing at all
 *
 * Asserted as a **round trip**, not as a spelling. What matters is that whatever Max writes
 * means what Max meant; how it is punctuated is not the point and pinning it would be the same
 * mistake one level up.
 */
test('whatever Max fills in, the amount field reads back as the same number', () => {
  const cases: [bigint, number, string][] = [
    // Below the grouping threshold: this always worked, and must keep working.
    [999_000000n, 6, 'USDT'],
    [999_999999n, 6, 'USDT'],
    // The band that was broken. 9,999 is the largest parseSendAmount accepts.
    [1000_000000n, 6, 'USDT'],
    [1000_500000n, 6, 'USDT'],
    [1234_560000n, 6, 'USDT'],
    [2500_000000n, 6, 'USDT'],
    [9999_000000n, 6, 'USDT'],
    [9999_999999n, 6, 'USDT'],
    // Native ETH, 18 decimals, including a value that uses every place.
    [1n, 18, 'ETH'],
    [1_000000000000000000n, 18, 'ETH'],
    [1234_123456789012345678n, 18, 'ETH'],
    [9999_999999999999999999n, 18, 'ETH'],
  ];
  for (const [value, decimals, symbol] of cases) {
    const filled = amountForInput(value, decimals);
    assert.ok(!filled.includes(','), `Max must not write a thousands separator, but wrote "${filled}"`);
    const parsed = parseSendAmount(filled, decimals, symbol);
    assert.equal(parsed, value,
      `Max filled "${filled}" for ${value} base units of ${symbol}, which reads back as ${parsed}`);
  }
});

test('Max is exact, not rounded down', () => {
  // A maximum that quietly drops the last places is not a maximum, and the shortfall is
  // unspendable afterwards. `formatUnits`'s default shows 6 places; at 18 decimals that
  // discards twelve of them.
  const dust = 1234_123456789012345678n;
  assert.equal(parseSendAmount(amountForInput(dust, 18), 18, 'ETH'), dust);
});

/**
 * The call-site half, and the reason it is written as an absence.
 *
 * The round-trip cases above protect `amountForInput`. They do not protect the Send screen
 * from going back to `setAmount(formatUnits(...))`, which is the actual bug — reverting that
 * one line leaves every case above passing. Testing the function is not testing the caller,
 * and that gap is how this shipped.
 *
 * So this names the **dangerous** pattern rather than the safe one. A check for the presence
 * of `amountForInput` would pass as soon as the identifier appeared anywhere in the file, which
 * is precisely the hollow guard that let an earlier fix regress unnoticed (see PR #58). A check
 * for the absence of a grouped formatter flowing into the amount field fails the moment the bug
 * comes back, however it is spelled.
 */
test('no display formatter is written into the amount field', () => {
  const file = new URL('../src/screens/LiveWallet.tsx', import.meta.url).pathname;
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const bad = /setAmount\(\s*(formatUnits|formatEth|[^)]*toLocaleString)/.exec(source);
  assert.equal(bad, null,
    `${bad?.[0]} — formatUnits and formatEth group thousands with toLocaleString('en-US'), and ` +
    'the amount field reads a lone comma as a decimal point. Use amountForInput().');
  // And the screen must still be filling the field from somewhere, or the check above is
  // satisfied by a Max button that does nothing at all.
  assert.match(source, /setAmount\(amountForInput\(/,
    'the Max button must still fill the amount field');
});
