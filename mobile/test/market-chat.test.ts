import test from 'node:test';
import assert from 'node:assert/strict';
import { quickMarketReply } from '../src/services/market-chat.ts';

test('asset questions answer with an explainer and that asset’s card', () => {
  for (const [prompt, symbol] of [['Explain Bitcoin', 'BTC'], ['explain ethereum in simple terms', 'ETH'], ['Tell me about Solana?', 'SOL'], ['What is USDT?', 'USDT'], ['What’s ETH', 'ETH']] as const) {
    const reply = quickMarketReply(prompt);
    assert.deepEqual(reply?.tool, { kind: 'asset', symbol }, prompt);
    assert.ok(reply!.text.length > 40);
  }
});
test('movers and display currency open their own chat cards', () => {
  for (const prompt of ['Show top movers', 'top movers', 'Show me today’s biggest movers']) assert.equal(quickMarketReply(prompt)?.tool?.kind, 'movers', prompt);
  for (const prompt of ['Choose display currency', 'change my currency', 'Set local currency']) assert.equal(quickMarketReply(prompt)?.tool?.kind, 'currency', prompt);
});
test('anything else is left to the assistant', () => {
  for (const prompt of ['What is a stablecoin?', 'Explain Bitcoin then send 25 USDT', 'How is Bitcoin different from Ethereum?', 'What is my balance?', 'Explain Dogecoin']) assert.equal(quickMarketReply(prompt), null, prompt);
});
