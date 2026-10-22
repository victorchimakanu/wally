import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, units, validateDraft, submit, settle, scriptedReply, appendChatMessages, draftStatus, MAX_CHAT_MESSAGES, DEMO_RECIPIENT, FEE, type Message } from '../src/demo/model.ts';

const draft = { recipient: DEMO_RECIPIENT, amount: '25' };
const quote = { ...draft, id: 'quote-1', expiresAt: 10_000 };
test('decimal amounts preserve all six digits and reject misleading formats', () => {
  assert.equal(units('0.000001'), 1);
  assert.equal(units('25.123456'), 25_123_456);
  for (const bad of ['0', '-1', '1e2', '1,000', '1.0000001', 'NaN', ' 25', '01', '1.']) assert.equal(units(bad), null);
});
test('validation includes the fee and full address', () => {
  assert.equal(validateDraft(draft, 25_000_000 + FEE), null);
  assert.match(validateDraft(draft, 25_000_000)!, /balance/);
  assert.match(validateDraft({ ...draft, recipient: '0x123' }, 99_000_000)!, /complete/);
  assert.match(validateDraft({ ...draft, recipient: `0x${'0'.repeat(40)}` }, 99_000_000)!, /non-zero/);
});
test('offline, expired, and duplicate approval cannot debit a second time', () => {
  const initial = initialState();
  assert.equal(submit({ ...initial, offline: true }, quote, 100).state.balance, initial.balance);
  assert.equal(submit(initial, quote, 10_000).state.balance, initial.balance);
  const result = submit(initial, quote, 100);
  assert.equal(result.state.balance, initial.balance - 25_020_000);
  assert.ok(submit(result.state, quote, 101).error);
  assert.equal(submit(result.state, quote, 101).state.balance, result.state.balance);
});
test('pending transactions settle after delay and failed transfers refund once', () => {
  const initial = initialState();
  const pending = submit({ ...initial, failNext: true }, quote, 100).state;
  assert.equal(settle(pending, 4099), pending);
  const failed = settle(pending, 4100);
  assert.equal(failed.transactions[0].status, 'failed');
  assert.equal(failed.balance, initial.balance);
  assert.equal(settle(failed, 9000).balance, initial.balance);
  const success = settle(submit(initial, quote, 100).state, 4100);
  assert.equal(success.transactions[0].status, 'confirmed');
  assert.equal(success.balance, initial.balance - 25_020_000);
});
test('scripted parser preserves exact values and refuses ambiguous or unsupported sends', () => {
  const state = initialState();
  assert.deepEqual(scriptedReply(`Send 25.000001 USDT on Arbitrum to ${DEMO_RECIPIENT}`, state).draft, { recipient: DEMO_RECIPIENT, amount: '25.000001' });
  for (const text of [`Send 25 ETH to ${DEMO_RECIPIENT}`, `Send 25 USDT to ${DEMO_RECIPIENT} on Ethereum`, `Send 25 USDT to ${DEMO_RECIPIENT} and then send 20`, 'Send 25 USDT to my friend']) assert.equal(scriptedReply(text, state).draft, undefined);
  assert.equal(scriptedReply(`Send 25 USDT to ${DEMO_RECIPIENT}`, { ...state, aiPaused: true }).draft, undefined);
});

test('chat history is capped, keeping the newest messages', () => {
  // Unbounded history grew forever and store.tsx re-serialises the whole state to
  // AsyncStorage on every change, so every change paid for all of it.
  const message = (n: number): Message => ({ id: `m${n}`, role: n % 2 ? 'assistant' : 'user', text: `message ${n}` });
  const many = Array.from({ length: MAX_CHAT_MESSAGES + 50 }, (_, i) => message(i));

  const capped = appendChatMessages(many, [message(9999)]);
  assert.equal(capped.length, MAX_CHAT_MESSAGES);
  assert.equal(capped.at(-1)!.id, 'm9999', 'the newest message must survive');
  assert.equal(capped[0]!.id, `m${50 + 1}`, 'the oldest are the ones dropped');

  // Below the cap nothing is touched.
  const short = appendChatMessages([message(1), message(2)], [message(3)]);
  assert.equal(short.length, 3);
});

test('capping does not break the draft-supersede behaviour', () => {
  const draft = { amount: '10', recipient: '0x' + '1'.repeat(40) };
  const withDraft: Message = { id: 'old-draft', role: 'assistant', text: 'review this', draft };
  const filler = Array.from({ length: MAX_CHAT_MESSAGES }, (_, i) => ({ id: `f${i}`, role: 'user' as const, text: `f${i}` }));

  // An active draft still inside the window must be retired by a replacement.
  const result = appendChatMessages([withDraft], [{ id: 'new', role: 'assistant', text: 'new', draft }]);
  assert.equal(draftStatus(result[0]!), 'superseded');

  // One trimmed out of the window is simply gone; originIsCurrent then reports it stale.
  const trimmed = appendChatMessages([withDraft, ...filler], [{ id: 'newest', role: 'user', text: 'hi' }]);
  assert.ok(!trimmed.some(m => m.id === 'old-draft'));
});
