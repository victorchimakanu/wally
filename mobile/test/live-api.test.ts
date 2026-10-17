import test from 'node:test';
import assert from 'node:assert/strict';
import { chartPoints, formatChange, parseChart, parseMarket, parseSavedChart, parseSavedMarket } from '../src/services/market-api.ts';
import { CHAINS, createWalletClient, formatEth, parseQuote, parseWallet, wei } from '../src/services/wallet-api.ts';
import { quickLiveReply, liveIntentReply } from '../src/services/live-wallet-chat.ts';
const address = '0x1111111111111111111111111111111111111111';
const balance = (chain: 'arbitrum' | 'ethereum') => ({ chain, name: CHAINS[chain].name, chainId: CHAINS[chain].id, symbol: 'ETH', address, qr: 'data:image/svg+xml;base64,PHN2Zy8+', balance: '0', balanceWei: '0', error: '' });
const snapshot = () => ({ version: 1, network: 'testnet', location: 'computer', fetchedAt: 1000, balances: [balance('arbitrum'), balance('ethereum')], tokenNotice: 'testnet' });
const quote = () => ({ id: '12345678-1234-1234-1234-123456789012', chain: 'arbitrum', chainId: 421614, network: 'Arbitrum Sepolia', symbol: 'ETH', from: address, recipient: address, amount: '0.001', fee: '0.000021', total: '0.001021', expiresAt: 61000 });
test('market parses only allowed assets, preserves losses and unavailable fields', () => {
  const data = parseMarket([{ id: 'bitcoin', current_price: 80000, price_change_percentage_24h: -2.5 }, { id: 'tether', current_price: 1, price_change_percentage_24h: 0.02 }, { id: 'unlisted', current_price: 100 }], 'NGN', 1000);
  assert.equal(data.assets.length, 2); assert.equal(data.currency, 'NGN'); assert.equal(data.assets[0].cap, null); assert.equal(formatChange(data.assets[0].change), '-2.50%'); assert.equal(formatChange(data.assets[1].change), '+0.02%');
  assert.throws(() => parseMarket([{ id: 'bitcoin', current_price: NaN }], 'USD'));
  assert.throws(() => parseSavedMarket({ ...data, currency: 'USD' }, 'NGN', 2000));
  assert.throws(() => parseSavedMarket({ ...data, assets: [{ ...data.assets[0], cap: Infinity }] }, 'NGN', 2000));
});
test('charts reject corrupt cache and preserve time spacing and flat values', () => {
  const data = parseChart({ prices: [[1000, 5], [2000, 5], [5000, 5]] }, 'bitcoin', 'EUR', 7, 1000);
  assert.deepEqual(chartPoints(data.points, 100, 100), [{ x: 0, y: 50 }, { x: 25, y: 50 }, { x: 100, y: 50 }]);
  assert.throws(() => parseSavedChart({ ...data, points: [[1000, 3], [1000, 4]] }, 'bitcoin', 'EUR', 7, 2000));
  assert.throws(() => parseChart({ prices: [[1000, 5], [2000, -2]] }, 'bitcoin', 'USD', 1));
});
test('wallet responses preserve unavailable balances and reject fake zero, mainnet and inconsistent units', () => {
  assert.equal(parseWallet(snapshot()).balances[0].balance, '0');
  const data = snapshot(); Object.assign(data.balances[0], { balance: null, balanceWei: null, error: 'RPC down' });
  assert.equal(parseWallet(data).balances[0].balance, null);
  assert.throws(() => parseWallet({ ...data, network: 'mainnet' }));
  assert.throws(() => parseWallet({ ...data, balances: [{ ...balance('arbitrum'), balance: '1', balanceWei: '0' }, balance('ethereum')] }));
  assert.equal(wei('0.000000000000000001'), 1n); assert.throws(() => wei('1e-3'));
});
test('review validation rejects incorrect totals, networks and excessive fees', () => {
  assert.equal(parseQuote(quote()).total, '0.001021');
  assert.throws(() => parseQuote({ ...quote(), total: '0.001' })); assert.throws(() => parseQuote({ ...quote(), chainId: 1 }));
  assert.throws(() => parseQuote({ ...quote(), fee: '1', total: '1.001' }));
});
test('wallet commands route to real data tools and never produce a simulation draft', () => {
  assert.equal(quickLiveReply('What is my balance?')?.tool?.kind, 'live-balances');
  assert.equal(quickLiveReply('What is my Arbitrum address?')?.tool?.kind, 'live-receive');
  assert.equal(quickLiveReply('Show my transaction history')?.tool?.kind, 'live-activity');
  const reply = quickLiveReply(`Send 25 USDT on Arbitrum to ${address}`); assert.equal(reply?.tool?.kind, 'live-send'); assert.equal(reply?.draft, undefined);
  assert.match(liveIntentReply({ intent: 'balance', token: 'BTC', chain: 'bitcoin', amount: '', recipient: '' }).text, /not connected/);
});
test('a lost confirmation response is not automatically retried', async () => {
  let submissions = 0;
  const client = createWalletClient('http://127.0.0.1:3003', (async (url: string) => {
    if (url.endsWith('/session')) return Response.json({ ready: true, network: 'testnet' });
    submissions++; throw new TypeError('Failed to fetch');
  }) as typeof fetch);
  await assert.rejects(client.confirm(parseQuote(quote())), /Check Activity/); assert.equal(submissions, 1);
});
test('wallet totals are formatted from wei without rounding up', () => {
  assert.equal(formatEth(0n), '0');
  assert.equal(formatEth(wei('1.5') + wei('0.25')), '1.75');
  assert.equal(formatEth(wei('0.1234569')), '0.123456');
  assert.equal(formatEth(1n), '<0.000001');
  assert.equal(formatEth(wei('12345.5')), '12,345.5');
});
