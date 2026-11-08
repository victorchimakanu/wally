import test from 'node:test';
import assert from 'node:assert/strict';
import { appendChatMessages, draftStatus, originIsCurrent, initialState, submit, DEMO_RECIPIENT, type Message } from '../src/demo/model.ts';
import { quickWalletReply } from '../src/services/qvac.ts';

const draft = { recipient: DEMO_RECIPIENT, amount: '25' };
const message: Message = { id: 'draft', role: 'assistant', text: 'Review first', draft };
test('new proposals retire earlier controls without erasing cancelled or submitted history', () => {
  const old = [message, { ...message, id: 'cancelled', draftCancelled: true }, { ...message, id: 'submitted', draftState: 'submitted' as const, transactionId: 'tx' }];
  const next = appendChatMessages(old, [{ ...message, id: 'new', draft: { ...draft, amount: '30' } }]);
  assert.deepEqual(next.map(draftStatus), ['superseded', 'cancelled', 'submitted', 'active']);
  assert.equal(old[0].draftState, undefined);
  assert.equal(draftStatus(appendChatMessages([message], [{ id: 'explanation', role: 'assistant', text: 'Fees explained' }])[0]), 'active');
});
test('a quote belongs to exactly one active draft with unchanged recipient and amount', () => {
  const state = { ...initialState(), chats: [{ id: 'chat', title: 'Transfer', updatedAt: 0, messages: [message] }] };
  const origin = { chatId: 'chat', messageId: 'draft' };
  assert.equal(originIsCurrent(state, origin, draft), true);
  assert.equal(originIsCurrent(state, origin, { ...draft, amount: '30' }), false);
  assert.equal(originIsCurrent(state, { ...origin, chatId: 'other' }, draft), false);
  for (const draftState of ['superseded', 'cancelled', 'submitted'] as const) {
    const retired = { ...state, chats: [{ ...state.chats[0], messages: [{ ...message, draftState }] }] };
    const result = submit(retired, { ...draft, origin, id: 'quote', expiresAt: 1000 }, 1);
    assert.ok(result.error);
    assert.equal(result.state.balance, state.balance);
    assert.deepEqual(result.state.transactions, []);
  }
  assert.equal(submit(state, { ...draft, origin, id: 'quote', expiresAt: 1000 }, 1).error, undefined);
});
test('read-only tool cards preserve the balance and transaction snapshot instead of asking inference', () => {
  const state = { ...initialState(), balance: 85_000_000 };
  const balance = quickWalletReply('What is my balance?', state)!;
  assert.deepEqual(balance.tool, { kind: 'balances', balance: 85_000_000, offline: false, transactionId: undefined });
  assert.equal(quickWalletReply('Show my Arbitrum receive address', state)?.tool?.kind, 'receive');
  assert.equal(quickWalletReply('Show crypto market', state)?.tool?.kind, 'market');
  assert.equal(quickWalletReply('Show my transaction history', state)?.tool?.kind, 'activity');
  assert.equal(quickWalletReply('Show crypto market then send 25 USDT', state), null);
});
