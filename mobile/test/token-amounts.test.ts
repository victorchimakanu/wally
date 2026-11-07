import test from 'node:test';
import assert from 'node:assert/strict';
import { toBaseUnits, formatUnits, wei, formatEth } from '../src/services/wallet-api.ts';
import { TOKENS, tokensFor, tokenAt, allTokens } from '../src/services/tokens.ts';

/**
 * Converting a typed amount into the integer the chain moves.
 *
 * This is the most dangerous arithmetic in the app. ETH has 18 decimals and USDt has 6, and
 * both produce a perfectly valid integer — so using the wrong one sends a million million
 * times the intended amount and nothing complains. Every case here exists because getting it
 * wrong moves someone's money.
 */

test('the same amount means different integers for different tokens, and that is the whole point', () => {
  // One USDt is 1e6 base units. One ETH is 1e18. Reading a USDt amount with the ETH scale
  // would send 1,000,000,000,000 times too much.
  assert.equal(toBaseUnits('1', 6, 'USDT'), 1_000_000n);
  assert.equal(toBaseUnits('1', 18, 'ETH'), 10n ** 18n);
  assert.equal(toBaseUnits('1', 18) / toBaseUnits('1', 6), 10n ** 12n);

  // The ordinary case someone types.
  assert.equal(toBaseUnits('10.50', 6, 'USDT'), 10_500_000n);
  assert.equal(toBaseUnits('0.000001', 6, 'USDT'), 1n, 'the smallest USDt unit');
  assert.equal(toBaseUnits('0', 6, 'USDT'), 0n);
});

test('a place the token cannot express is refused, never truncated', () => {
  // Truncating would send a different amount from the one on screen. USDt has six places.
  assert.throws(() => toBaseUnits('0.0000001', 6, 'USDT'), /up to 6 decimals/);
  assert.throws(() => toBaseUnits('1.1234567', 6, 'USDT'), /up to 6 decimals/);
  // Six is fine, seven is not — the boundary is the thing worth pinning.
  assert.equal(toBaseUnits('1.123456', 6, 'USDT'), 1_123_456n);

  // And the message names the unit, because "up to 6 decimals" is confusing advice to
  // somebody who thinks they are sending ETH.
  assert.throws(() => toBaseUnits('0.0000001', 6, 'USDT'), /in USDT/);
  assert.throws(() => wei('0.0000000000000000001'), /in ETH/);
});

test('the comma rule still applies, at every token scale', () => {
  // A lone comma is a decimal point — the rule from wallet-api.ts, which must not change
  // meaning just because the token did.
  assert.equal(toBaseUnits('1,5', 6, 'USDT'), 1_500_000n);
  assert.equal(toBaseUnits('1,5', 18), toBaseUnits('1.5', 18));
});

test('zero decimals is a real case and does not produce a stray fraction', () => {
  assert.equal(toBaseUnits('7', 0, 'POINTS'), 7n);
  assert.throws(() => toBaseUnits('7.5', 0, 'POINTS'), /whole number/);
  assert.equal(formatUnits(7n, 0), '7');
});

test('a nonsensical decimals value is refused rather than trusted', () => {
  // decimals arrives from a token definition. A malformed one must fail loudly here, not
  // produce a plausible-looking integer.
  for (const bad of [-1, 1.5, Number.NaN, 37, Infinity]) {
    assert.throws(() => toBaseUnits('1', bad as number, 'X'), /whole number of decimals/, `decimals ${bad}`);
  }
});

test('formatting round-trips, and never shows a real balance as zero', () => {
  for (const [value, decimals, expected] of [
    [1_000_000n, 6, '1'],
    [10_500_000n, 6, '10.5'],
    [1n, 6, '0.000001'],
    [12_399_380_000_000_000n, 6, '12,399,380,000'],
    [10n ** 18n, 18, '1'],
  ] as const) {
    assert.equal(formatUnits(value, decimals), expected, `${value} @ ${decimals}`);
  }

  // A tiny non-zero holding must not read as nothing — telling someone they hold zero when
  // they do not is worse than an awkward string.
  assert.equal(formatUnits(1n, 18), '<0.000001');
  assert.equal(formatUnits(0n, 18), '0');

  // Round-trip through both directions at both scales.
  for (const [text, decimals] of [['10.5', 6], ['0.000001', 6], ['1.5', 18], ['0', 6]] as const) {
    assert.equal(formatUnits(toBaseUnits(text, decimals, 'X'), decimals), text === '0' ? '0' : text);
  }
});

test('the native-ETH helpers are the same implementation, not a copy', () => {
  // If these ever diverge from toBaseUnits/formatUnits, one of the two money paths is wrong
  // and nothing else would say so.
  assert.equal(wei('1.5'), toBaseUnits('1.5', 18, 'ETH'));
  assert.equal(formatEth(10n ** 18n), formatUnits(10n ** 18n, 18, 6));
  assert.equal(formatEth(1n), formatUnits(1n, 18, 6));
});

test('the pinned testnet USDt matches what the chain reports', () => {
  // Read off Arbitrum Sepolia by eth_call on 6 Nov 2026. If a future edit changes these, the
  // amount arithmetic above silently changes meaning.
  const [usdt, ...rest] = tokensFor('arbitrum');
  assert.ok(usdt, 'Arbitrum must carry USDt');
  assert.deepEqual(rest, [], 'one token for now');
  assert.equal(usdt.address, '0xE5b6C29411b3ad31C3613BbA0145293fC9957256');
  assert.equal(usdt.symbol, 'USDT');
  assert.equal(usdt.decimals, 6, 'six, not eighteen — the whole reason this file exists');

  // Honest about provenance: there is no official Tether testnet deployment, and the app says
  // so rather than implying this is Tether's.
  assert.equal(usdt.official, false);

  // Ethereum stays native-only on purpose.
  assert.deepEqual(tokensFor('ethereum'), []);
});

test('an unknown contract is never guessed at', () => {
  // Inventing a token from an address means guessing its decimals, and guessing 18 for a
  // 6-decimal token is the million-million error this whole file is about.
  assert.equal(tokenAt('arbitrum', '0x1111111111111111111111111111111111111111'), null);
  assert.equal(tokenAt('ethereum', '0xE5b6C29411b3ad31C3613BbA0145293fC9957256'), null, 'right token, wrong chain');

  // Found case-insensitively, because addresses arrive in both casings.
  assert.equal(tokenAt('arbitrum', '0xe5b6c29411b3ad31c3613bba0145293fc9957256')?.symbol, 'USDT');
  assert.equal(tokenAt('arbitrum', '  0xE5b6C29411b3ad31C3613BbA0145293fC9957256  ')?.decimals, 6);
});

test('every pinned token is internally consistent', () => {
  for (const token of allTokens()) {
    assert.match(token.address, /^0x[0-9a-fA-F]{40}$/, `${token.symbol} address`);
    assert.ok(Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36, `${token.symbol} decimals`);
    assert.ok(token.symbol.length > 0 && token.name.length > 0, `${token.symbol} labels`);
    // Every address must be usable by toBaseUnits without throwing on its own decimals.
    assert.doesNotThrow(() => toBaseUnits('1', token.decimals, token.symbol));
  }
  assert.equal(new Set(allTokens().map(t => t.address.toLowerCase())).size, allTokens().length, 'no duplicate addresses');
  assert.equal(Object.keys(TOKENS).sort().join(','), 'arbitrum,ethereum');
});

test('a snapshot whose token amount does not match its raw integer is refused', async () => {
  const { parseWallet, CHAINS } = await import('../src/services/wallet-api.ts');
  const address = '0x1111111111111111111111111111111111111111';
  const entry = (chain: 'arbitrum' | 'ethereum', symbol: string, balance: string, balanceWei: string) => ({
    chain, name: CHAINS[chain].name, chainId: CHAINS[chain].id, symbol, address,
    qr: 'data:image/svg+xml;base64,PHN2Zy8+', balance, balanceWei, error: '',
  });
  const snap = (balances: unknown[]) => ({ version: 1, network: 'testnet', location: 'computer', fetchedAt: 1000, balances, tokenNotice: 't' });

  // The honest case: 10.5 USDt is 10_500_000 base units at six decimals.
  assert.doesNotThrow(() => parseWallet(snap([
    entry('arbitrum', 'ETH', '0', '0'),
    entry('arbitrum', 'USDT', '10.5', '10500000'),
    entry('ethereum', 'ETH', '0', '0'),
  ])));

  // The dangerous case, and the reason this check exists: a server that formatted USDt with
  // eighteen decimals would send 10.5 alongside 10500000000000000000. That must be refused,
  // not displayed — the two disagree about how much money there is.
  assert.throws(() => parseWallet(snap([
    entry('arbitrum', 'ETH', '0', '0'),
    entry('arbitrum', 'USDT', '10.5', '10500000000000000000'),
    entry('ethereum', 'ETH', '0', '0'),
  ])), /Invalid wallet amount/);

  // An asset nobody pinned has unknown decimals, so there is no safe way to show it.
  assert.throws(() => parseWallet(snap([
    entry('arbitrum', 'ETH', '0', '0'),
    entry('arbitrum', 'SCAM', '1', '1'),
    entry('ethereum', 'ETH', '0', '0'),
  ])), /Invalid wallet balance/);

  // A token on the wrong chain is equally unknown: USDt is pinned for Arbitrum only.
  assert.throws(() => parseWallet(snap([
    entry('arbitrum', 'ETH', '0', '0'),
    entry('ethereum', 'USDT', '1', '1000000'),
    entry('ethereum', 'ETH', '0', '0'),
  ])), /Invalid wallet balance/);

  // The same asset twice is a duplicate, even though the chain now legitimately repeats.
  assert.throws(() => parseWallet(snap([
    entry('arbitrum', 'USDT', '1', '1000000'),
    entry('arbitrum', 'USDT', '2', '2000000'),
    entry('ethereum', 'ETH', '0', '0'),
  ])), /Invalid wallet balance/);
});
