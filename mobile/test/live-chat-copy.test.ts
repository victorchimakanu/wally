import test from 'node:test';
import assert from 'node:assert/strict';
import { liveIntentReply, quickLiveReply, tokenAssets } from '../src/services/live-wallet-chat.ts';
import { tokensFor } from '../src/services/tokens.ts';
import type { WalletIntent } from '../src/services/qvac.ts';

/**
 * Chat must not deny a feature the wallet has.
 *
 * For eleven days this file's subject told users "USDt transfers are not configured" while the
 * Send screen's asset picker — built from the same `tokensFor()` these tests read — would send
 * USDt perfectly well. A balance reply said USDt was "not connected" for thirteen days after
 * the balance shipped. Nothing failed, because no test asserted the relationship between the
 * copy and the token list; the one assertion that existed checked that Bitcoin was refused.
 *
 * So these cases are deliberately written against `tokensFor()` rather than against strings. A
 * test that pinned the new sentences would go stale exactly the way the sentences did.
 */

/** The phrases a user reads as "you cannot do this here". */
const DENIALS = /not connected|not configured|not supported|not available|cannot (?:send|read|show)/i;

const intent = (over: Partial<WalletIntent>): WalletIntent =>
  ({ intent: 'balance', chain: 'all', token: 'unknown', amount: '', recipient: '', ...over });

test('every connected token is one the chat is willing to talk about', () => {
  // The guard that was missing. For each token the Send screen can actually send, no reply may
  // tell the user it is unavailable.
  for (const asset of tokenAssets()) {
    const token = asset.symbol as WalletIntent['token'];
    for (const where of [{}, { chain: asset.chain }, { chain: 'all' as const }, { chain: 'unknown' as const }]) {
      const reply = liveIntentReply(intent({ intent: 'balance', token, ...where }));
      assert.doesNotMatch(reply.text, DENIALS, `balance reply denies ${asset.symbol}: ${reply.text}`);
      assert.equal(reply.tool?.kind, 'live-balances');
    }
  }
});

test('the transfer reply names every asset Send can send', () => {
  const reply = liveIntentReply(intent({ intent: 'transfer' }));
  assert.doesNotMatch(reply.text, DENIALS, reply.text);
  assert.equal(reply.tool?.kind, 'live-send');
  for (const asset of tokenAssets()) {
    // 'USDT' is the contract's symbol; the app writes it USDt. Compare case-insensitively so
    // the house style is free to change without this failing for the wrong reason.
    assert.match(reply.text, new RegExp(asset.symbol, 'i'), `transfer reply omits ${asset.symbol}`);
  }
  assert.match(reply.text, /ETH/);
});

test('the fallback and the receive reply describe the same assets', () => {
  for (const reply of [liveIntentReply(intent({ intent: 'unknown' as WalletIntent['intent'] })), liveIntentReply(intent({ intent: 'address' }))]) {
    for (const asset of tokenAssets()) assert.match(reply.text, new RegExp(asset.symbol, 'i'), `omits ${asset.symbol}: ${reply.text}`);
  }
});

test('an asset that is genuinely absent is still refused', () => {
  // The direction the old copy got right, and the reason DENIALS above is not simply banned.
  // Bitcoin has no chain here at all.
  assert.match(liveIntentReply(intent({ token: 'BTC', chain: 'bitcoin' })).text, /Bitcoin is not connected/);
  assert.match(liveIntentReply(intent({ token: 'BTC' })).text, /Bitcoin is not connected/);
  assert.match(liveIntentReply(intent({ chain: 'bitcoin' })).text, /Bitcoin is not connected/);
});

test('a token asked for on the wrong network is corrected, not denied', () => {
  // USDt is Arbitrum-only by design. Telling someone it is "not connected" because they named
  // Ethereum would be false; saying nothing would leave them hunting a balance that cannot
  // exist there.
  const arbitrumOnly = tokenAssets().filter(asset => !tokensFor('ethereum').some(token => token.symbol === asset.symbol));
  for (const asset of arbitrumOnly) {
    const reply = liveIntentReply(intent({ token: asset.symbol as WalletIntent['token'], chain: 'ethereum' }));
    assert.doesNotMatch(reply.text, DENIALS, reply.text);
    assert.match(reply.text, /Arbitrum Sepolia only/);
    assert.match(reply.text, /Ethereum Sepolia is native ETH only/);
  }
});

test('chat still refuses to put an amount or a recipient in a draft', () => {
  // Unchanged by this file's rewrite and the reason it needs no amountAppearsInText(): the
  // model's numbers are discarded rather than validated, so Send opens empty.
  const reply = quickLiveReply('Send 25 USDT on Arbitrum to 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7');
  assert.equal(reply?.tool?.kind, 'live-send');
  assert.equal(reply?.draft, undefined);
  assert.doesNotMatch(reply?.text ?? '', /25/);
  assert.doesNotMatch(reply?.text ?? '', /0x742d/i);
});
