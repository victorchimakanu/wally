import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  STORED_DATA, clearEntries, clearStoredData, describeStoredData, entryFor,
  inCategories, owns, resolveKeys,
  type AsyncStore, type ClearDeps, type DataId, type SecureStore,
} from '../src/services/app-data.ts';

/**
 * "Remove this wallet from this phone" deleted two keystore entries and left the chat history,
 * the address book and a cache of the user's own addresses in app storage. The bug was that no
 * single place knew the full list, so these tests are mostly about the list staying true: the
 * first two read the source and fail when the table and the code disagree, in either
 * direction. The rest are about telling the truth when a deletion only half works.
 */

// ---------------------------------------------------------------------------------------------
// The guard: the table and the code cannot drift apart.
// ---------------------------------------------------------------------------------------------

function sources(dir: string, found: { path: string; text: string }[] = []): { path: string; text: string }[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { sources(path, found); continue; }
    if (!/\.tsx?$/.test(name)) continue;
    if (path.endsWith(join('services', 'app-data.ts'))) continue;  // The table itself.
    found.push({ path, text: readFileSync(path, 'utf8') });
  }
  return found;
}

/** Comments name keys while explaining them; only real code can store something. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** `wally.market.v1.${currency}` is the key `wally.market.v1.` plus a value. */
const literals = (text: string) =>
  [...text.matchAll(/wally\.[A-Za-z0-9._${}-]*/g)].map(match => match[0].split('${')[0]!);

/**
 * Whether this file can store anything at all.
 *
 * Needed because not every `wally.*` string is a storage key — `useScreenPrivacy('wally.
 * recovery-phrase')` is a screen tag. Rather than keep a list of exceptions, which the next
 * person would quietly add to, the test asks whether the file touches a store. A file with no
 * way to write cannot have left anything behind.
 */
const touchesStorage = (text: string) => /AsyncStorage|SecureStorage|secure-storage|expo-secure-store|setItemAsync|deleteItemAsync/.test(text);

test('every stored key is declared in STORED_DATA', () => {
  const undeclared: string[] = [];
  for (const file of sources('src')) {
    const code = stripComments(file.text);
    if (!touchesStorage(code)) continue;
    for (const key of literals(code)) {
      if (STORED_DATA.some(entry => owns(entry, key) || entry.key === key)) continue;
      undeclared.push(`${file.path}: ${key}`);
    }
  }
  assert.deepEqual(undeclared, [],
    'A storage key exists that "delete my data" knows nothing about. Add it to STORED_DATA in ' +
    'src/services/app-data.ts with its category, or it will survive a wipe the user was told was complete.');
});

test('every STORED_DATA entry is still stored by something', () => {
  // The reverse drift. An entry for a key nothing writes any more makes the confirmation
  // screen list data this phone does not hold, which is its own kind of dishonesty — and it
  // hides the removal of a feature behind a passing wipe.
  const all = sources('src').flatMap(file => literals(stripComments(file.text)));
  for (const entry of STORED_DATA) {
    const used = entry.exact ? all.includes(entry.key) : all.some(key => key.startsWith(entry.key) || entry.key.startsWith(key));
    assert.ok(used, `STORED_DATA lists ${entry.key} (${entry.owner}) but no source file writes it.`);
  }
});

test('the screen-privacy tags are not mistaken for storage', () => {
  // Proves the rule above discriminates rather than passing by luck: these are real wally.*
  // literals in src/ that are deliberately absent from the table.
  assert.ok(!STORED_DATA.some(entry => owns(entry, 'wally.recovery-phrase')));
  assert.ok(!STORED_DATA.some(entry => owns(entry, 'wally.restore-wallet')));
  assert.equal(touchesStorage("useScreenPrivacy('wally.recovery-phrase');"), false);
  assert.equal(touchesStorage("AsyncStorage.getItem('wally.thing.v1')"), true);
});

// ---------------------------------------------------------------------------------------------
// The table's own shape.
// ---------------------------------------------------------------------------------------------

test('the wallet is listed but never in a wipe, and labels are written for people', () => {
  assert.equal(inCategories(['keys']).length, 2, 'the two keystore entries');

  // Listed so the "what is on this phone" answer is complete; deleted by wallet-keystore.ts,
  // which also has to tear down the worklet holding the keys open.
  const asked = inCategories(['keys', 'personal']);
  assert.ok(asked.some(entry => entry.category === 'keys'));

  for (const entry of STORED_DATA) {
    assert.ok(!entry.label.includes('wally.'), `${entry.key}'s label is a storage key, not a description`);
    assert.ok(entry.label.length > 8, `${entry.key} has no usable label`);
    assert.ok(entry.owner.includes('/'), `${entry.key} does not say where it is written`);
    if (!entry.exact) assert.ok(entry.key.endsWith('.'), `${entry.key} is a prefix that would also match a sibling key`);
  }
});

test('the description lists content once, without keys', () => {
  const described = describeStoredData(['personal']);
  assert.deepEqual([...new Set(described)], described, 'a label appeared twice');
  assert.ok(described.some(line => /chat/i.test(line)));
  assert.ok(described.some(line => /recipient/i.test(line)));
  assert.ok(!described.some(line => /\.v1/.test(line)));
});

test('a prefix entry resolves only its own keys', () => {
  const entry = STORED_DATA.find(item => item.key === 'wally.testnet.wallet.v1.')!;
  const resolved = resolveKeys([entry], [
    'wally.testnet.wallet.v1.http://127.0.0.1:3003',
    'wally.testnet.wallet.v1.http://192.168.0.5:3003',
    'wally.market.v1.NGN',
    'unrelated',
  ]);
  assert.deepEqual(resolved, [
    'wally.testnet.wallet.v1.http://127.0.0.1:3003',
    'wally.testnet.wallet.v1.http://192.168.0.5:3003',
  ], 'two wallet servers mean two caches of this user’s addresses, and both are theirs');
});

// ---------------------------------------------------------------------------------------------
// Deleting, and being honest about it.
// ---------------------------------------------------------------------------------------------

function stores(contents: Record<string, string>, refuse: string[] = []) {
  const kept = { ...contents };
  const asyncStore: AsyncStore = {
    getAllKeys: async () => Object.keys(kept),
    removeItem: async key => { if (refuse.includes(key)) throw new Error('disk is full'); delete kept[key]; },
  };
  const secure: SecureStore = {
    deleteItemAsync: async key => { if (refuse.includes(key)) throw new Error('keystore locked'); delete kept[key]; },
  };
  return { kept, deps: { async: asyncStore, secure } satisfies ClearDeps };
}

const phone = () => ({
  'wally.wallet.record.v1': 'ciphertext',
  'wally.wallet.encryptionKey.v1': 'key',
  'wally.frontend-demo.v1': 'chats',
  'wally.frontend-preferences.v1': 'recipients',
  'wally.testnet.wallet.v1.http://127.0.0.1:3003': 'balances',
  'wally.appLock.v1': 'on',
  'wally.phone-benchmark.v1': 'timings',
  'wally.market.v1.NGN': 'prices',
  'wally.chart.v1.ethereum.NGN.7': 'chart',
});

test('a personal wipe takes everything about the user and leaves public prices', async () => {
  const { kept, deps } = stores(phone());
  const result = await clearStoredData(['personal'], deps);

  assert.deepEqual(result.kept, [], 'nothing should have survived by accident');
  assert.deepEqual(Object.keys(kept).sort(), [
    // The keys: removed by wallet-keystore.ts, not from here.
    'wally.wallet.encryptionKey.v1',
    'wally.wallet.record.v1',
    // Public data. Deleting it protects nobody and costs a slow first screen.
    'wally.chart.v1.ethereum.NGN.7',
    'wally.market.v1.NGN',
  ].sort());
});

test('asking for the keys does not delete them', async () => {
  // The table lists them so the app can say what is on the phone. Removing them needs the
  // worklet shut down too, so this function must refuse even when told to.
  const { kept, deps } = stores(phone());
  await clearStoredData(['keys'], deps);
  assert.equal(kept['wally.wallet.record.v1'], 'ciphertext');
  assert.equal(kept['wally.wallet.encryptionKey.v1'], 'key');
});

test('clearing the caches as well leaves nothing of Wally behind', async () => {
  const { kept, deps } = stores(phone());
  await clearStoredData(['personal', 'cache'], deps);
  assert.deepEqual(Object.keys(kept).sort(), ['wally.wallet.encryptionKey.v1', 'wally.wallet.record.v1']);
});

test('one refusal does not save the rest, and is reported in the words the user was shown', async () => {
  const { kept, deps } = stores(phone(), ['wally.frontend-demo.v1']);
  const result = await clearStoredData(['personal'], deps);

  // The point: the chat history refusing must not leave the address book sitting there.
  assert.equal(kept['wally.frontend-demo.v1'], 'chats');
  assert.equal(kept['wally.frontend-preferences.v1'], undefined);
  assert.equal(kept['wally.appLock.v1'], undefined);

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0]!.label, 'Your chat history');
  assert.equal(result.kept[0]!.reason, 'disk is full');
  assert.ok(!result.kept[0]!.label.includes('wally.'), 'a person cannot act on a storage key');
  assert.ok(!result.removed.includes('wally.frontend-demo.v1'));
});

test('a keystore that refuses is reported, not thrown', async () => {
  const { kept, deps } = stores(phone(), ['wally.appLock.v1']);
  const result = await clearStoredData(['personal'], deps);
  assert.deepEqual(result.kept.map(item => item.label), ['Whether app lock is switched on']);
  assert.equal(kept['wally.appLock.v1'], 'on');
  assert.equal(kept['wally.frontend-demo.v1'], undefined, 'the rest still went');
});

test('a store that will not list its keys still gives up the keys we can name', async () => {
  const { kept, deps } = stores(phone());
  deps.async.getAllKeys = async () => { throw new Error('storage unavailable'); };
  const result = await clearStoredData(['personal'], deps);

  // Exact keys need no listing, so they go.
  assert.equal(kept['wally.frontend-demo.v1'], undefined);
  assert.equal(kept['wally.phone-benchmark.v1'], undefined);
  // The prefixed one cannot be found without a listing, and says so rather than being claimed.
  assert.equal(kept['wally.testnet.wallet.v1.http://127.0.0.1:3003'], 'balances');
  assert.deepEqual(result.kept.map(item => item.label), ['Your saved balances and wallet addresses']);
  assert.equal(result.kept[0]!.reason, 'storage unavailable');
});

test('on a platform with no keystore, its entries are absent rather than failed', async () => {
  // The browser. expo-secure-store has no web implementation, so there is nothing stored
  // there — reporting it as undeletable would be a warning about data that does not exist.
  const { kept, deps } = stores(phone());
  const result = await clearStoredData(['personal'], { async: deps.async, secure: null });
  assert.deepEqual(result.kept, []);
  assert.equal(kept['wally.appLock.v1'], 'on', 'untouched, because nothing here could have written it');
  assert.equal(kept['wally.frontend-demo.v1'], undefined);
});

test('a refusal with no message still says something a person can read', async () => {
  const { deps } = stores(phone());
  deps.async.removeItem = async () => { throw new Error(''); };
  const result = await clearStoredData(['personal'], deps);
  for (const item of result.kept) assert.ok(item.reason.length > 10, `"${item.reason}" tells the user nothing`);
});

test('a wipe of a phone that stores nothing yet succeeds quietly', async () => {
  const { deps } = stores({});
  const result = await clearStoredData(['personal'], deps);
  assert.deepEqual(result.kept, []);
  // Exact keys are deleted unconditionally: removeItem on an absent key is not an error, and
  // checking first would be a race.
  assert.ok(result.removed.includes('wally.frontend-demo.v1'));
});

// ---------------------------------------------------------------------------------------------
// Deleting one named thing, which is what "clear chat history" needs.
// ---------------------------------------------------------------------------------------------

test('entries are reachable by name, and ids are unique', () => {
  // The id exists so that a call site wanting one entry does not have to write its storage
  // key, which would give the key a second home — the exact drift this file guards against.
  const ids = STORED_DATA.map(entry => entry.id);
  assert.deepEqual([...new Set(ids)], ids, 'two entries share an id');

  for (const entry of STORED_DATA) assert.equal(entryFor(entry.id), entry);
  assert.equal(entryFor('chats').key, 'wally.frontend-demo.v1');

  // An unknown id is a programming error, not a no-op: silently deleting nothing is how a
  // "clear my data" button comes to do nothing at all.
  // @ts-expect-error the union exists precisely to make this unwritable in real code
  assert.throws(() => entryFor('chat-history'), /No stored data is declared/);
});

test('clearing the chats takes the chats and nothing else', async () => {
  const { kept, deps } = stores(phone());
  const result = await clearEntries((['chats'] as DataId[]).map(entryFor), deps);

  assert.deepEqual(result.removed, ['wally.frontend-demo.v1']);
  assert.deepEqual(result.kept, []);
  // The whole point of the separate screen: wanting a conversation off the phone is not
  // wanting to leave, so the wallet, the recipients and the lock setting must survive.
  assert.equal(kept['wally.wallet.record.v1'], 'ciphertext');
  assert.equal(kept['wally.frontend-preferences.v1'], 'recipients');
  assert.equal(kept['wally.appLock.v1'], 'on');
  assert.equal(kept['wally.frontend-demo.v1'], undefined);
});

test('clearing one entry needs no key listing at all', async () => {
  // A listing is only needed to resolve prefixes. Asking for one anyway would make chat
  // clearing fail on a phone whose storage will not enumerate, for no reason.
  const { deps } = stores(phone());
  deps.async.getAllKeys = async () => { throw new Error('should not have been called'); };
  const result = await clearEntries((['chats'] as DataId[]).map(entryFor), deps);
  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.removed, ['wally.frontend-demo.v1']);
});

test('asking for a key entry by name is still refused', async () => {
  // clearStoredData filters by category; this proves the refusal lives in clearEntries, so a
  // caller reaching past the category API cannot delete key material behind the worklet.
  const { kept, deps } = stores(phone());
  const result = await clearEntries((['wallet-record', 'wallet-key', 'chats'] as DataId[]).map(entryFor), deps);
  assert.deepEqual(result.removed, ['wally.frontend-demo.v1']);
  assert.equal(kept['wally.wallet.record.v1'], 'ciphertext');
  assert.equal(kept['wally.wallet.encryptionKey.v1'], 'key');
});
