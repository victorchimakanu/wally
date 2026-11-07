import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalletVault, type SecureStorage } from '../src/services/wallet-vault.ts';
import { createKeystore, type EncryptedSecrets, type WorkletRpc } from '../src/services/wallet-keystore.ts';

/**
 * The worklet itself cannot run here, so what is tested is the sequencing around it — which
 * is the part that can leave a device holding a wallet it cannot open. The failure modes that
 * matter are a setup interrupted halfway, a second wallet written over a first, and the phrase
 * leaking into storage.
 */

const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident';

function fakeStorage(): SecureStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    async getItemAsync(k) { return items.get(k) ?? null; },
    async setItemAsync(k, v) { items.set(k, v); },
    async deleteItemAsync(k) { items.delete(k); },
  };
}

const bytes = (seed: number, length = 32): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 256);

function secrets(seed: number): EncryptedSecrets {
  return {
    encryptionKey: bytes(seed),
    encryptedSeedBuffer: bytes(seed + 1, 64),
    encryptedEntropyBuffer: bytes(seed + 2, 16),
  };
}

function fakeRpc(overrides: Partial<WorkletRpc> = {}) {
  const calls: string[] = [];
  const rpc: WorkletRpc = {
    async generateEntropyAndEncrypt(params) { calls.push(`generate:${params.wordCount}`); return secrets(1); },
    async getSeedAndEntropyFromMnemonic(params) { calls.push(`restore:${params.mnemonic}`); return secrets(5); },
    async getMnemonicFromEntropy() { calls.push('reveal'); return { mnemonic: PHRASE }; },
    async initializeWDK() { calls.push('init'); return null; },
    dispose() { calls.push('dispose'); },
    ...overrides,
  };
  return { rpc, calls };
}

function build(overrides: Partial<WorkletRpc> = {}) {
  const storage = fakeStorage();
  const vault = createWalletVault(storage);
  const { rpc, calls } = fakeRpc(overrides);
  let closed = 0;
  const keystore = createKeystore(vault, {
    async connect() { return { rpc, close() { closed++; } }; },
    config: async () => '{"networks":{}}',
  });
  return { keystore, vault, storage, calls, closed: () => closed };
}

test('creating a wallet stores the key and the record, and asks for 12 words', async () => {
  const { keystore, vault, calls } = build();

  const { mnemonic } = await keystore.create();

  assert.equal(mnemonic, PHRASE);
  assert.ok(calls.includes('generate:12'), 'Wally creates 12 words');
  // The phrase is read back through the same path "show it again" uses, so a broken reveal
  // fails while the wallet is still empty rather than when someone needs their phrase.
  assert.ok(calls.includes('reveal'));

  const record = await vault.read();
  assert.ok(record);
  assert.ok(await vault.encryptionKey());
  assert.equal(record.wordCount, 12);
  assert.equal(record.backedUpAt, 0, 'a new wallet is never pre-confirmed as backed up');
});

test('the phrase never reaches storage', async () => {
  const { keystore, storage } = build();
  await keystore.create();

  // The whole point of the worklet is that only ciphertext comes out. If a phrase or any of
  // its words ever lands in the vault, that guarantee is gone.
  const stored = [...storage.items.values()].join(' ');
  for (const word of PHRASE.split(' ')) {
    assert.doesNotMatch(stored, new RegExp(`\\b${word}\\b`), `"${word}" must not be stored`);
  }
});

test('a setup interrupted after the key was stored can be retried', async () => {
  // This is the wedge that nearly shipped: storeEncryptionKey refuses a *different* key over
  // an existing one, so a key written without its record would make every later attempt fail
  // and leave the install needing a factory reset.
  const { keystore, vault, storage } = build();
  await vault.storeEncryptionKey('ZGVicmlzLWZyb20tYS1mYWlsZWQtcnVu');
  assert.equal(await vault.has(), false, 'a key alone is not a wallet');

  await keystore.create();

  assert.equal(await vault.has(), true);
  assert.notEqual(await vault.encryptionKey(), 'ZGVicmlzLWZyb20tYS1mYWlsZWQtcnVu', 'the debris key must be replaced');
  assert.equal(storage.items.size, 2);
});

test('an existing wallet is never silently replaced', async () => {
  const { keystore, vault } = build();
  await keystore.create();
  const before = await vault.encryptionKey();

  await assert.rejects(() => keystore.create(), /already has a wallet/);
  await assert.rejects(() => keystore.restore(PHRASE), /already has a wallet/);

  // Overwriting would make the first wallet permanently unopenable.
  assert.equal(await vault.encryptionKey(), before);
});

test('restore checks the shape before waking the worklet, and counts as backed up', async () => {
  const { keystore, vault, calls } = build();

  await assert.rejects(() => keystore.restore('abandon ability able'), /3 words/);
  assert.deepEqual(calls, [], 'a malformed phrase must not reach the worklet at all');

  await keystore.restore(`  1. Abandon ability ABLE about above absent absorb abstract absurd abuse access accident `);
  // Normalised on the way in, so the worklet sees a clean phrase.
  assert.ok(calls.some(c => c === `restore:${PHRASE}`), `calls were ${JSON.stringify(calls)}`);

  // Typing the phrase proves they have it. Asking them to write down what they just read off
  // paper would be theatre, and would block sending for no gain.
  const record = await vault.read();
  assert.ok(record && record.backedUpAt > 0, 'a restored wallet is backed up by definition');
});

test('reveal and unlock refuse when there is no wallet, rather than guessing', async () => {
  const { keystore, calls } = build();
  await assert.rejects(() => keystore.reveal(), /no wallet on this device/);
  await assert.rejects(() => keystore.unlock(), /no wallet on this device/);
  assert.deepEqual(calls, []);
});

test('confirming the backup is what unblocks sending', async () => {
  const { keystore, vault } = build();
  await keystore.create();
  assert.equal((await vault.read())?.backedUpAt, 0);

  await keystore.confirmBackedUp();
  assert.ok(((await vault.read())?.backedUpAt ?? 0) > 0);
});

test('forgetting disposes the worklet before clearing, and survives a worklet that throws', async () => {
  const { keystore, vault, storage, calls, closed } = build();
  await keystore.create();

  await keystore.forget();

  // Disposed first: a live WDK instance must not be left holding keys for a wallet the device
  // no longer has.
  assert.ok(calls.indexOf('dispose') >= 0);
  assert.equal(closed(), 1);
  assert.equal(await vault.has(), false);
  assert.equal(storage.items.size, 0);

  // A worklet that refuses to tear down must not prevent the wallet being removed — a user
  // asking to erase their wallet has to get that, every time.
  const broken = build({ dispose() { throw new Error('worklet already gone'); } });
  await broken.keystore.create();
  await broken.keystore.forget();
  assert.equal(await broken.vault.has(), false);
});
