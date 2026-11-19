import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, droppedNotice, toStored, PREFERENCES_VERSION, SAMPLE_RECIPIENTS, withoutSampleRecipients, type Preferences, type Recipient } from '../src/services/preferences-store.ts';

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

test('appearance is read when valid, dropped when not, and absent when never set', () => {
  const base: Preferences = { name: 'A', currency: 'USD', saved: [], recipients: [] };
  assert.equal(parsePreferences({ appearance: 'dark' }, base).preferences.appearance, 'dark');
  const bad = parsePreferences({ appearance: 'sepia' }, base);
  assert.equal(bad.preferences.appearance, undefined);
  assert.deepEqual(bad.dropped, ['your appearance setting']);
  // A record from before the setting existed reads back without the key, so older
  // equality checks on preferences keep holding.
  assert.equal('appearance' in parsePreferences({ name: 'A' }, base).preferences, false);
});

/**
 * The samples are demo content, and on 19 Nov 2026 they were in a live wallet's address book.
 *
 * `0x1111…`, `0x6666…` and `0x4444…` are valid, non-zero and unowned: anything sent to one is
 * gone. `PreferencesProvider` is mounted app-wide, so Wallet → Send → Saved → Victor → Send
 * reached a prefilled transfer to a burn address in two taps, with nothing marking the entry as
 * a sample. `addressTrust()` is no help and cannot be: an address in the address book is
 * `known`, the one verdict that suppresses the warning.
 */
test('the sample recipients can be taken out for a wallet that can really spend', () => {
  const mine: Recipient = { id: 'real', name: 'A real person', address: '0x' + '7'.repeat(40), network: 'Arbitrum' };

  // Untouched samples go.
  assert.deepEqual(withoutSampleRecipients([...SAMPLE_RECIPIENTS]), []);
  // Everything else stays, in order.
  assert.deepEqual(withoutSampleRecipients([mine, ...SAMPLE_RECIPIENTS]), [mine]);

  // A real contact who happens to share a sample's name or id is NOT a sample. Matching on id
  // alone would delete this person's entry, which is worse than the bug being fixed.
  const sameId: Recipient = { id: 'victor', name: 'Victor', address: '0x' + '7'.repeat(40), network: 'Arbitrum' };
  assert.deepEqual(withoutSampleRecipients([sameId]), [sameId]);

  // And a sample whose address the user edited has become their own entry.
  const edited: Recipient = { ...SAMPLE_RECIPIENTS[0]!, address: '0x' + '8'.repeat(40) };
  assert.deepEqual(withoutSampleRecipients([edited]), [edited]);

  // Case is not a difference: the indexer, EIP-55 and the dev server disagree about it freely.
  const upper: Recipient = { ...SAMPLE_RECIPIENTS[0]!, address: SAMPLE_RECIPIENTS[0]!.address.toUpperCase().replace('0X', '0x') };
  assert.deepEqual(withoutSampleRecipients([upper]), []);
});

test('every sample address is one nobody holds, and none is the zero address', () => {
  // If a sample were ever changed to a real address this would stop being a burn hazard and
  // start being a worse one: a stranger's wallet seeded into everybody's address book.
  for (const sample of SAMPLE_RECIPIENTS) {
    assert.match(sample.address, /^0x([\da-f])\1{39}$/i,
      `${sample.name} must be an obvious placeholder, not a real-looking address`);
    assert.ok(!/^0x0{40}$/i.test(sample.address), 'the zero address is rejected elsewhere and would not behave like the others');
  }
});
