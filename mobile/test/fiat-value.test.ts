import test from 'node:test';
import assert from 'node:assert/strict';
import { fiatValue, fiatTotal, fiatDisplayable } from '../src/services/fiat-value.ts';
import type { Currency, MarketAsset } from '../src/services/market-api.ts';

/**
 * "0.042 ETH" means nothing to most people; "₦180,000" means something. But every balance in
 * this app is testnet and worth nothing, and the app says so on every screen — so the figure is
 * computed and not shown. These tests are mostly about the two ways it could lie: pricing an
 * asset in one currency and labelling it another, and totalling a set where one price is
 * missing.
 */

const asset = (symbol: string, price: number | null, currency: Currency = 'NGN'): MarketAsset => ({
  id: symbol.toLowerCase(), symbol, name: symbol, currency, price,
  change: null, cap: null, volume: null, supply: null, maximum: null, updatedAt: null,
});
const market = [asset('ETH', 3_005_601), asset('USDT', 1_345.8)];

test('the gate is shut until a mainnet is configured', () => {
  // The whole reason this ships unseen. Testnet tokens are worth nothing and the app says so.
  assert.equal(fiatDisplayable({ network: 'testnet' }), false);
  assert.equal(fiatDisplayable({ network: undefined }), false);
  assert.equal(fiatDisplayable({ network: '' }), false);
  assert.equal(fiatDisplayable({ network: 'mainnet' }), true);
});

test('a balance converts at the asset price', () => {
  const value = fiatValue('0.042', 'ETH', market, 'NGN');
  assert.equal(value.currency, 'NGN');
  assert.ok(Math.abs(value.amount! - 0.042 * 3_005_601) < 0.01);
  assert.equal(fiatValue('25', 'USDT', market, 'NGN').amount, 25 * 1_345.8);
});

test('a price in the wrong currency is refused, not relabelled', () => {
  // The market snapshot is fetched per currency, so a stale USD snapshot can be in hand while
  // the user has switched to NGN. Showing dollars with a naira sign is worse than showing none.
  const usd = [asset('ETH', 2_231.92, 'USD')];
  assert.equal(fiatValue('0.042', 'ETH', usd, 'NGN').amount, null);
  assert.equal(fiatValue('0.042', 'ETH', usd, 'USD').amount, 2_231.92 * 0.042);
});

test('nothing is invented when the price or the balance is unknown', () => {
  assert.equal(fiatValue(null, 'ETH', market, 'NGN').amount, null, 'an unavailable balance');
  assert.equal(fiatValue('0.042', 'DOGE', market, 'NGN').amount, null, 'an asset not in the market');
  assert.equal(fiatValue('0.042', 'ETH', [asset('ETH', null)], 'NGN').amount, null, 'a missing price');
  assert.equal(fiatValue('not a number', 'ETH', market, 'NGN').amount, null);
  assert.equal(fiatValue('-1', 'ETH', market, 'NGN').amount, null, 'a negative balance is not a balance');
  // And never NaN, which formats on screen as the word.
  for (const bad of ['', '  ', 'NaN', 'Infinity']) {
    const value = fiatValue(bad, 'ETH', market, 'NGN');
    assert.ok(value.amount === null || Number.isFinite(value.amount), bad);
  }
});

test('the symbol match is case-insensitive, as symbols are everywhere else', () => {
  assert.ok(fiatValue('1', 'eth', market, 'NGN').amount);
  assert.ok(fiatValue('1', 'usdt', market, 'NGN').amount);
});

test('a total refuses to add up a set it cannot price in full', () => {
  // A total that silently drops an asset is the kind of wrong that looks right — the same
  // reason the wallet screen already refuses to total a network that failed to refresh.
  const priced = fiatTotal([{ amount: '0.042', symbol: 'ETH' }, { amount: '25', symbol: 'USDT' }], market, 'NGN');
  assert.ok(Math.abs(priced.amount! - (0.042 * 3_005_601 + 25 * 1_345.8)) < 0.01);

  assert.equal(fiatTotal([{ amount: '0.042', symbol: 'ETH' }, { amount: '1', symbol: 'DOGE' }], market, 'NGN').amount, null);
  assert.equal(fiatTotal([{ amount: '0.042', symbol: 'ETH' }, { amount: null, symbol: 'USDT' }], market, 'NGN').amount, null);
});

test('an empty wallet totals zero rather than nothing', () => {
  // Nothing held is a knowable answer; nothing priced is not. They must not look the same.
  assert.equal(fiatTotal([], market, 'NGN').amount, 0);
  assert.equal(fiatTotal([{ amount: '0', symbol: 'ETH' }], market, 'NGN').amount, 0);
});
