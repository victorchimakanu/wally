import test from 'node:test';
import assert from 'node:assert/strict';
import { listedChats, type Chat } from '../src/demo/model.ts';

const chats: Chat[] = [
  { id: 'empty', title: 'New conversation', updatedAt: 30, messages: [] },
  { id: 'older', title: 'Send 25 USDT', updatedAt: 10, messages: [{ id: 'm1', role: 'user', text: 'Send 25 USDT' }] },
  { id: 'newer', title: 'Checking my balance', updatedAt: 20, messages: [{ id: 'm2', role: 'user', text: 'What is my balance?' }] },
];

test('listedChats leaves out empty placeholders and orders the rest newest first', () => {
  assert.deepEqual(listedChats(chats).map(chat => chat.id), ['newer', 'older']);
});

test('listedChats does not reorder its input and copes with nothing', () => {
  listedChats(chats);
  assert.deepEqual(chats.map(chat => chat.id), ['empty', 'older', 'newer']);
  assert.deepEqual(listedChats([]), []);
});
