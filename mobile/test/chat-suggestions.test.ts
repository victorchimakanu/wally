import test from 'node:test';
import assert from 'node:assert/strict';
import { chatSuggestions, type SuggestionContext } from '../src/services/chat-suggestions.ts';
import type { MarketAsset } from '../src/services/market-api.ts';
import type { WalletSnapshot } from '../src/services/wallet-api.ts';

const asset = (symbol: string, name: string, change: number | null): MarketAsset => ({ id: name.toLowerCase(), symbol, name, currency: 'USD', price: 1, change, cap: null, volume: null, supply: null, maximum: null, updatedAt: null });
const wallet = (wei: string): WalletSnapshot => ({ version: 1, network: 'testnet', location: 'computer', fetchedAt: 1, tokenNotice: '', balances: (['arbitrum', 'ethereum'] as const).map(chain => ({ chain, name: chain, chainId: 1, symbol: 'ETH' as const, address: `0x${'1'.repeat(40)}`, qr: '', balance: '0', balanceWei: wei, error: '' })) });
const base: SuggestionContext = { live: true, wallet: null, history: null, market: [], asked: [] };
const labels = (context: Partial<SuggestionContext>) => chatSuggestions({ ...base, ...context }).map(item => item.label);

test('an empty live wallet is pointed at receiving before sending', () => {
  assert.equal(labels({ wallet: wallet('0') })[0], 'Get my address to receive testnet ETH');
  assert.equal(labels({ wallet: wallet('1000') })[0], 'Send testnet ETH');
  assert.equal(labels({ live: false })[0], 'Send 25 USDt to Victor');
});
test('an asset topic leads with that asset and keeps wallet actions only where they apply', () => {
  assert.deepEqual(labels({ topic: 'ETH', wallet: wallet('0') }), ['Explain Ethereum in simple terms', 'Get my address to receive testnet ETH', 'Show my testnet ETH balance']);
  assert.deepEqual(labels({ topic: 'BTC' }), ['Explain Bitcoin in simple terms', 'How is Bitcoin different from Ethereum?', 'What affects Bitcoin’s price?']);
  assert.equal(labels({ topic: 'USDT' })[1], 'What is a stablecoin?');
  assert.equal(labels({ topic: 'DOGE' })[0], 'Send testnet ETH');
});
test('notable movers, pending transfers and earlier chats surface as real shortcuts', () => {
  const items = chatSuggestions({ ...base, wallet: wallet('1'), market: [asset('BTC', 'Bitcoin', 0.4), asset('SOL', 'Solana', -5.26), asset('USDT', 'Tether', 9)], history: { version: 1, fetchedAt: 1, source: 'rpc', errors: [], items: [{ hash: `0x${'a'.repeat(64)}`, chain: 'arbitrum', status: 'pending', explorerUrl: '' }] }, recent: { id: 'old', title: 'A very long conversation title that keeps going' } });
  assert.deepEqual(items.map(item => item.label), ['Send testnet ETH', 'Check my pending transfer', 'Check Solana, down 5.3% today']);
  assert.deepEqual(items[1].action, { kind: 'send', text: 'Show my transaction history' });
  assert.deepEqual(items[2].action, { kind: 'send', text: 'Explain Solana' });
  assert.equal(labels({ recent: { id: 'old', title: 'A very long conversation title that keeps going' } })[1], 'Continue “A very long conversation title…”');
});
test('requests already sent in the conversation are not suggested again', () => {
  assert.deepEqual(labels({ topic: 'BTC', asked: [' explain bitcoin in simple terms '] }), ['How is Bitcoin different from Ethereum?', 'What affects Bitcoin’s price?', 'Show today’s crypto market']);
});
test('every suggestion answers in chat; only an earlier conversation opens another screen', () => {
  const contexts: Partial<SuggestionContext>[] = [{}, { wallet: wallet('0') }, { wallet: wallet('1') }, { live: false }, { topic: 'ETH', wallet: wallet('1') }, { topic: 'USDT' }, { recent: { id: 'old', title: 'Earlier' }, market: [asset('SOL', 'Solana', 7)] }];
  for (const context of contexts) for (const item of chatSuggestions({ ...base, ...context })) assert.ok(item.action.kind === 'send' || item.action.pathname === '/chat', item.label);
});
