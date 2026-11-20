import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTALL_HEADER, INSTALL_ID_KEY, isInstallId } from '../src/services/install-id.ts';
import { STORED_DATA } from '../src/services/app-data.ts';

/**
 * The random name this installation sends the backend, so two phones behind one carrier
 * address are two rate-limit budgets instead of half a budget each.
 *
 * These cases are about the constraints rather than the mechanism, because the mechanism is
 * four lines and the constraints are the whole point: random rather than derived from the
 * device, declared so a wipe covers it, and useless as a credential.
 */

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

test('a UUID is an id and nothing else is', () => {
  assert.equal(isInstallId(ID), true);
  for (const bad of [
    undefined, null, '', '   ', 'not-a-uuid', ID.slice(0, 20), `${ID} `, ID.replace('-', ''),
    ID.toUpperCase(), 'zzzzzzzz-4f89-41d3-9a0c-0305e82c3301', 42, {}, [ID],
  ]) assert.equal(isInstallId(bad), false, `accepted ${JSON.stringify(bad)}`);
});

test('a stored value that is not an id is replaced, not repaired', () => {
  // The backend refuses anything that is not exactly the shape, so sending a salvaged half of
  // one achieves nothing — it would be budgeted per address while looking like it was not.
  assert.equal(isInstallId(ID.slice(0, 30)), false);
});

test('the key is declared in the table that knows everything this phone stores', () => {
  // app-data.test.ts fails in both directions — an undeclared key and an entry nothing writes
  // — so this is really asserting the entry says the right things about itself.
  const entry = STORED_DATA.find(item => item.id === 'install');
  assert.ok(entry, 'the installation id is not declared in STORED_DATA');
  assert.equal(entry.key, INSTALL_ID_KEY);
  // Personal, not cache: it is an identifier this device holds, so a wipe must cover it. In
  // 'cache' it would survive "delete my data", which is the one outcome that is unacceptable.
  assert.equal(entry.category, 'personal');
  assert.equal(entry.store, 'async');
  assert.equal(entry.owner, 'services/install-id.ts');
});

test('it is not stored where key material lives', () => {
  // Not 'keys': deletion deliberately never touches that category, and this is not a secret.
  const entry = STORED_DATA.find(item => item.id === 'install');
  assert.notEqual(entry?.category, 'keys');
});

test('the header name matches what the backend reads', () => {
  // The two halves are in separate packages that cannot import each other, which is exactly
  // how the token list came to need backend/test/usdt.test.ts. Same failure, same fix.
  assert.equal(INSTALL_HEADER, 'x-wally-install');
});

test('nothing in the id is derived from the device', async () => {
  // A hardware identifier would follow the person to other apps and survive a reinstall,
  // which is a tracking id rather than a rate-limit key. Asserted against the source so the
  // constraint survives somebody reaching for expo-application later.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/services/install-id.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const forbidden of [
    'expo-application', 'expo-device', 'androidId', 'getIosIdForVendor',
    'deviceName', 'modelName', 'osBuildId', 'Math.random',
  ]) assert.ok(!code.includes(forbidden), `install-id.ts reaches for ${forbidden}`);
  // And it does use a real random source.
  assert.ok(code.includes('randomUUID') || code.includes('getRandomValues'));
});
