import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletVault, isVaultRecord, toBase64, type SecureStorage } from '../src/services/wallet-vault.ts';

/**
 * The vault holds the only copy of a wallet that exists on the device, so the cases that
 * matter are the ones where it would be tempting to be helpful: a corrupt record, a partial
 * write, a second call that quietly replaces a key.
 */

function fakeStorage(): SecureStorage & { items: Map<string, string>; deleted: string[] } {
  const items = new Map<string, string>();
  const deleted: string[] = [];
  return {
    items, deleted,
    async getItemAsync(k) { return items.get(k) ?? null; },
    async setItemAsync(k, v) { items.set(k, v); },
    async deleteItemAsync(k) { deleted.push(k); items.delete(k); },
  };
}

test('base64 encodes with correct padding at every length', () => {
  assert.equal(toBase64(new Uint8Array([])), '');
  assert.equal(toBase64(new Uint8Array([77])), 'TQ==');
  assert.equal(toBase64(new Uint8Array([77, 97])), 'TWE=');
  assert.equal(toBase64(new Uint8Array([77, 97, 110])), 'TWFu');
  // 32 bytes is the encryption key size; it must round-trip through Node's decoder.
  const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7 % 256);
  assert.deepEqual(new Uint8Array(Buffer.from(toBase64(key), 'base64')), key);
});

test('the encryption key is stored, never invented here', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  // No wallet yet. This used to generate and store a key, which looked like a sensible
  // create-once pattern and was wrong: the worklet's generateEntropyAndEncrypt chooses the
  // key itself and returns it, so a key invented here would never decrypt the ciphertext it
  // was supposed to belong to. Absent must read as absent.
  assert.equal(await vault.encryptionKey(), null);
  assert.equal(storage.items.size, 0, 'reading a key must not create one');

  await vault.storeEncryptionKey('d29ya2xldC1rZXk=');
  assert.equal(await vault.encryptionKey(), 'd29ya2xldC1rZXk=');

  // Idempotent for the same key, so a retried setup step is harmless.
  await vault.storeEncryptionKey('d29ya2xldC1rZXk=');
  assert.equal(storage.items.size, 1);
});

test('a second, different key is refused rather than overwriting the first', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);
  await vault.storeEncryptionKey('Zmlyc3Q=');

  // Overwriting makes the existing wallet permanently unopenable, and the phrase is the only
  // way back. Replacing a wallet goes through clear() instead.
  await assert.rejects(() => vault.storeEncryptionKey('c2Vjb25k'), /already stored/);
  assert.equal(await vault.encryptionKey(), 'Zmlyc3Q=');

  await assert.rejects(() => vault.storeEncryptionKey('   '), /empty encryption key/);
});

test('a corrupt or partial record reads as absent, never as repaired', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  for (const bad of [
    'not json at all',
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 2, encryptedEntropy: 'a', encryptedSeed: 'b', wordCount: 12, backedUpAt: 0 }),
    JSON.stringify({ version: 1, encryptedEntropy: '', encryptedSeed: 'b', wordCount: 12, backedUpAt: 0 }),
    JSON.stringify({ version: 1, encryptedEntropy: 'a', encryptedSeed: 'b', wordCount: 13, backedUpAt: 0 }),
    JSON.stringify({ version: 1, encryptedEntropy: 'a', encryptedSeed: 'b', wordCount: 12, backedUpAt: -1 }),
  ]) {
    storage.items.set('wally.wallet.record.v1', bad);
    assert.equal(await vault.read(), null, `must reject: ${bad.slice(0, 40)}`);
    assert.equal(await vault.has(), false);
  }
});

test('a good record round-trips and reports the wallet as present', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  assert.equal(await vault.has(), false);
  await vault.write({ encryptedEntropy: 'ZW50', encryptedSeed: 'c2VlZA==', wordCount: 12, backedUpAt: 0 });

  const read = await vault.read();
  assert.ok(read);
  assert.equal(read.encryptedEntropy, 'ZW50');
  assert.equal(read.wordCount, 12);
  assert.equal(read.version, 1);
  assert.equal(await vault.has(), true);
});

test('a malformed write is refused rather than stored', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  await assert.rejects(
    () => vault.write({ encryptedEntropy: '', encryptedSeed: 'x', wordCount: 12, backedUpAt: 0 }),
    /malformed/,
  );
  assert.equal(storage.items.size, 0, 'nothing may be persisted from a refused write');
});

test('backed-up state is recorded, and cannot be set without a wallet', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  await assert.rejects(() => vault.markBackedUp(1_700_000_000_000), /no wallet/);

  await vault.write({ encryptedEntropy: 'ZW50', encryptedSeed: 'c2VlZA==', wordCount: 24, backedUpAt: 0 });
  await vault.markBackedUp(1_700_000_000_000);

  const read = await vault.read();
  assert.equal(read?.backedUpAt, 1_700_000_000_000);
  // Marking backup must not disturb the key material it sits beside.
  assert.equal(read?.encryptedEntropy, 'ZW50');
  assert.equal(read?.wordCount, 24);
});

test('clear removes the key as well as the record', async () => {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);

  await vault.storeEncryptionKey('d29ya2xldC1rZXk=');
  await vault.write({ encryptedEntropy: 'ZW50', encryptedSeed: 'c2VlZA==', wordCount: 12, backedUpAt: 0 });
  await vault.clear();

  // Leaving the key behind would be worse than leaving nothing: it looks like a usable
  // install while the ciphertext it belongs to is gone.
  assert.equal(await vault.has(), false);
  assert.equal(storage.items.size, 0);
  assert.deepEqual(storage.deleted.sort(), ['wally.wallet.encryptionKey.v1', 'wally.wallet.record.v1']);
});

test('isVaultRecord rejects everything that is not exactly the shape', () => {
  assert.equal(isVaultRecord(null), false);
  assert.equal(isVaultRecord('string'), false);
  assert.equal(isVaultRecord([]), false);
  assert.equal(isVaultRecord({}), false);
  assert.equal(
    isVaultRecord({ version: 1, encryptedEntropy: 'a', encryptedSeed: 'b', wordCount: 12, backedUpAt: 0 }),
    true,
  );
});

test('base64 round-trips, and refuses damaged key material rather than returning part of it', async () => {
  const { fromBase64 } = await import('../src/services/wallet-vault.ts');

  for (const length of [0, 1, 2, 3, 16, 31, 32, 64, 65]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes, `${length} bytes must round-trip`);
  }

  // Agreement with Node's own decoder, so the hand-rolled pair is not merely self-consistent.
  const key = Uint8Array.from({ length: 32 }, (_, i) => (i * 7) % 256);
  assert.deepEqual(fromBase64(Buffer.from(key).toString('base64')), key);

  // Half a key is not a key. A silent partial decode would mean a decrypt that yields rubbish.
  assert.throws(() => fromBase64('not base64!'), /not valid base64/);
  assert.throws(() => fromBase64('AAAAA'), /truncated/);
});
