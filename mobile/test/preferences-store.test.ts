import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, droppedNotice, toStored, PREFERENCES_VERSION, type Preferences } from '../src/services/preferences-store.ts';

/**
 * The address book lives in this record. The old loader validated the whole object in one
 * expression and threw if any part failed; the caller's catch fell back to defaults. So one
 * malformed recipient — or any change to the shape in a later release — silently replaced
 * every address the user had saved with three samples, under the message "Saved preferences
 * could not be loaded".
 *
 * These are about the failure being proportionate: a bad field costs that field.
 */

const ADDR = (c: string) => '0x' + c.repeat(40);
const defaults: Preferences = {
  name: 'Daniel', currency: 'USD', saved: ['BTC', 'ETH'],
  recipients: [{ id: 'sample', name: 'Sample', address: ADDR('1'), network: 'Arbitrum' }],
};
const mine = [
  { id: 'victor', name: 'Victor', address: ADDR('a'), network: 'Arbitrum' },
  { id: 'emmy', name: 'Emmy', address: ADDR('b'), network: 'Ethereum' },
];

test('a good record loads unchanged', () => {
  const stored = { version: 1, name: 'Ada', currency: 'NGN', saved: ['ETH'], recipients: mine };
  const { preferences, dropped } = parsePreferences(stored, defaults);
  assert.deepEqual(dropped, []);
  assert.equal(preferences.name, 'Ada');
  assert.equal(preferences.currency, 'NGN');
  assert.deepEqual(preferences.recipients, mine);
});

test('one bad recipient costs that recipient and nothing else', () => {
  // The bug. Previously this wiped the address book and the name and the currency with it.
  const stored = {
    name: 'Ada', currency: 'NGN', saved: ['ETH'],
    recipients: [...mine, { id: 'broken', name: 'Broken', address: 'not-an-address', network: 'Arbitrum' }],
  };
  const { preferences, dropped } = parsePreferences(stored, defaults);
  assert.equal(preferences.recipients.length, 2, 'the two good recipients must survive');
  assert.deepEqual(preferences.recipients, mine);
  assert.equal(preferences.name, 'Ada', 'the name is not collateral damage');
  assert.equal(preferences.currency, 'NGN');
  assert.deepEqual(dropped, ['1 saved recipient']);
});

test('an unknown currency costs the currency, not the address book', () => {
  const stored = { name: 'Ada', currency: 'GBP', saved: ['ETH'], recipients: mine };
  const { preferences, dropped } = parsePreferences(stored, defaults);
  assert.equal(preferences.currency, 'USD', 'falls back');
  assert.deepEqual(preferences.recipients, mine, 'and nothing else is touched');
  assert.deepEqual(dropped, ['your chosen currency']);
});

test('a field this version has never seen is simply ignored', () => {
  // Forward compatibility: an older build reading a newer record keeps what it understands.
  const stored = { version: 99, name: 'Ada', currency: 'NGN', saved: ['ETH'], recipients: mine, theme: 'midnight' };
  const { preferences, dropped } = parsePreferences(stored, defaults);
  assert.deepEqual(dropped, []);
  assert.deepEqual(preferences.recipients, mine);
});

test('an emptied address book stays empty', () => {
  // A user who deleted every recipient must not be handed the samples back on next launch.
  const { preferences, dropped } = parsePreferences({ name: 'Ada', currency: 'USD', saved: [], recipients: [] }, defaults);
  assert.deepEqual(preferences.recipients, []);
  assert.deepEqual(dropped, []);
});

test('nothing stored yet is not a failure', () => {
  for (const empty of [null, undefined]) {
    const { preferences, dropped } = parsePreferences(empty, defaults);
    assert.deepEqual(preferences, defaults);
    assert.deepEqual(dropped, [], 'a first launch must not report a problem');
  }
});

test('junk on disk falls back and says so', () => {
  const { preferences, dropped } = parsePreferences('not an object', defaults);
  assert.deepEqual(preferences, defaults);
  assert.deepEqual(dropped, ['everything saved on this device']);
});

test('the notice names what went, or says nothing at all', () => {
  assert.equal(droppedNotice([]), null);
  const notice = droppedNotice(['2 saved recipients', 'your chosen currency'])!;
  assert.match(notice, /2 saved recipients/);
  assert.match(notice, /Everything else was kept/);
});

test('what is written carries a version', () => {
  const stored = toStored(defaults) as Record<string, unknown>;
  assert.equal(stored.version, PREFERENCES_VERSION);
  assert.deepEqual(stored.recipients, defaults.recipients);
  // And a round trip is lossless.
  assert.deepEqual(parsePreferences(stored, defaults).preferences, defaults);
});

test('a recipient with a plausible but wrong address is refused', () => {
  // Addresses are where money goes. Length and hex are not optional.
  for (const bad of ['0x' + 'a'.repeat(39), '0x' + 'a'.repeat(41), 'a'.repeat(40), '0x' + 'g'.repeat(40)]) {
    const { preferences } = parsePreferences(
      { name: 'Ada', currency: 'USD', saved: [], recipients: [{ id: 'x', name: 'X', address: bad, network: 'Arbitrum' }] },
      defaults);
    assert.deepEqual(preferences.recipients, [], `accepted ${bad}`);
  }
});
