import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveTransferSummary, nameFor, shortAddress } from '../src/services/transfer-summary.ts';
import { clockLabel, dayGroups, whenLabel } from '../src/services/when.ts';

const me = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const victor = '0x1111111111111111111111111111111111111111';
const recipients = [{ name: 'Victor', address: victor }];
const base = { hash: '0xabc', chain: 'arbitrum' as const, explorerUrl: '', status: 'pending' as const };

test('a transfer from one of our addresses reads as sent, to the saved name when there is one', () => {
  const summary = liveTransferSummary({ ...base, from: me, recipient: victor, amount: '0.01' }, [me], recipients);
  assert.equal(summary.sent, true);
  assert.equal(summary.title, 'To Victor');
  assert.equal(summary.headline, 'Sent 0.01 ETH to Victor');
  assert.equal(summary.meta, 'Pending · Arbitrum Sepolia');
  assert.equal(summary.amount, '−0.01 ETH');
  assert.equal(summary.failed, false);
});

test('a transfer to us reads as received, with a short address when nobody saved the sender', () => {
  const summary = liveTransferSummary({ ...base, from: '0x6666666666666666666666666666666666666666', recipient: me, amount: '25', symbol: 'USDT', status: 'confirmed' }, [me.toUpperCase()], recipients);
  assert.equal(summary.sent, false);
  assert.equal(summary.title, 'From 0x6666…6666');
  assert.equal(summary.headline, 'Received 25 USDT');
  assert.equal(summary.amount, '+25 USDT');
});

test('failed and superseded transfers are marked failed; a missing amount is a dash, not zero', () => {
  assert.equal(liveTransferSummary({ ...base, from: me, status: 'superseded' }, [me], []).failed, true);
  assert.equal(liveTransferSummary({ ...base, from: me, status: 'superseded' }, [me], []).meta, 'Never arrived · Arbitrum Sepolia');
  assert.equal(liveTransferSummary({ ...base, from: me }, [me], []).amount, '−— ETH');
});

test('names match case-insensitively and addresses shorten to six and four', () => {
  assert.equal(nameFor(victor.toUpperCase().replace('0X', '0x'), recipients), 'Victor');
  assert.equal(nameFor(undefined, recipients), null);
  assert.equal(shortAddress(victor), '0x1111…1111');
});

test('whenLabel says Today and Yesterday by calendar day, and dates anything older', () => {
  const now = new Date(2026, 10, 28, 9, 0).getTime();
  assert.match(whenLabel(new Date(2026, 10, 28, 0, 10).getTime(), now), /^Today, /);
  assert.match(whenLabel(new Date(2026, 10, 27, 23, 50).getTime(), now), /^Yesterday, /);
  const older = whenLabel(new Date(2026, 10, 26, 11, 24).getTime(), now);
  assert.doesNotMatch(older, /^(Today|Yesterday)/);
  assert.match(older, /26/);
  assert.equal(clockLabel(new Date(2026, 10, 28, 9, 5).getTime()), new Date(2026, 10, 28, 9, 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
});

test('dayGroups splits a newest-first list under Today, Yesterday and Earlier, keeping its order', () => {
  const now = new Date(2026, 10, 28, 9, 0).getTime();
  const at = (item: { t?: number }) => item.t;
  const items = [{ t: now - 60e3 }, { t: new Date(2026, 10, 28, 0, 5).getTime() }, { t: new Date(2026, 10, 27, 23, 55).getTime() }, { t: new Date(2026, 10, 20).getTime() }, {}];
  const groups = dayGroups(items, at, now);
  assert.deepEqual(groups.map(group => [group.title, group.items.length]), [['Today', 2], ['Yesterday', 1], ['Earlier', 2]]);
  assert.deepEqual(groups[0].items, items.slice(0, 2));
  assert.deepEqual(dayGroups([], at, now), []);
});
