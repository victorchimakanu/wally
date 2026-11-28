/**
 * Where the wallet's key material lives on this device.
 *
 * Nothing here ever holds a seed or a mnemonic in plaintext. WDK encrypts the entropy and the
 * seed inside the Bare worklet using a key this module supplies, and only the ciphertext comes
 * back out. So the vault stores two things:
 *
 *   encryptionKey    32 random bytes, in the OS keystore (iOS Keychain / Android Keystore)
 *   encryptedEntropy ciphertext, useless without that key
 *
 * Losing the keystore entry means losing the wallet, which is why the recovery phrase is the
 * real backup and why nothing may be signed until the user has written it down. See
 * docs/ADR-001-key-custody.md.
 *
 * The storage backend is injected so this can be tested without a device. In the app it is
 * expo-secure-store; in tests it is a fake. Everything in here is deliberately free of React
 * and of any native import at module scope.
 */

/** The subset of expo-secure-store this module uses. */
export type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type VaultRecord = {
  /** Ciphertext produced by the worklet. Base64. */
  encryptedEntropy: string;
  /** Ciphertext produced by the worklet. Base64. */
  encryptedSeed: string;
  /** 12 or 24. Needed to turn entropy back into a phrase for the backup screen. */
  wordCount: number;
  /** When the user last confirmed they have written the phrase down. 0 means never. */
  backedUpAt: number;
  /** Schema version, so a later change can migrate rather than guess. */
  version: 1;
};

const KEY_ENCRYPTION = 'wally.wallet.encryptionKey.v1';
const KEY_RECORD = 'wally.wallet.record.v1';

/** base64 without relying on Buffer, which React Native does not provide by default. */
export function toBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : chars[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : chars[c & 63];
  }
  return out;
}

/**
 * The inverse of toBase64, for handing stored ciphertext back to the worklet.
 *
 * The worklet's handlers run `Buffer.isBuffer()` on these (pear-wrk-wdk
 * src/utils/validation.js:50), but a Uint8Array is what should be sent: the HRPC wire format
 * encodes a buffer field through compact-encoding's `uint8array` codec and decodes it with
 * `subarray`, so what arrives inside the Bare runtime is a real Buffer regardless of which of
 * the two was passed in. React Native has no Buffer, so Uint8Array is also the only option.
 *
 * Throws on anything that is not valid base64 rather than returning partial bytes. Half a key
 * is not a key, and failing here is far better than a decrypt that silently yields rubbish.
 */
export function fromBase64(text: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = text.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) throw new Error('Stored key material is not valid base64.');
  if (clean.length % 4 === 1) throw new Error('Stored key material is truncated.');

  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let accumulator = 0;
  let at = 0;
  for (const character of clean) {
    accumulator = (accumulator << 6) | chars.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (accumulator >> bits) & 0xff;
    }
  }
  return out;
}

export function isVaultRecord(value: unknown): value is VaultRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.encryptedEntropy === 'string' && r.encryptedEntropy.length > 0 &&
    typeof r.encryptedSeed === 'string' && r.encryptedSeed.length > 0 &&
    (r.wordCount === 12 || r.wordCount === 24) &&
    typeof r.backedUpAt === 'number' && Number.isSafeInteger(r.backedUpAt) && r.backedUpAt >= 0
  );
}

export function createWalletVault(storage: SecureStorage) {
  return {
    /**
     * The key the entropy and seed were encrypted with, or null when this install has no
     * wallet.
     *
     * **This used to generate a key when none was stored**, which read as a sensible
     * create-once-and-reuse pattern and was wrong. The worklet does not accept a key: WDK's
     * `generateEntropyAndEncrypt` calls `encryptSecrets` internally and *returns* the key it
     * chose, alongside the ciphertext — see pear-wrk-wdk `src/handlers/secrets.js`. A key
     * invented here would never decrypt anything the worklet produced, so the failure would
     * have surfaced as an unopenable wallet rather than as an error at the point of the
     * mistake. It is a read now, and `storeEncryptionKey` records what the worklet sent back.
     */
    async encryptionKey(): Promise<string | null> {
      return await storage.getItemAsync(KEY_ENCRYPTION);
    },

    /**
     * Record the key the worklet returned. Called once, with the ciphertext it belongs to.
     *
     * Refuses to overwrite silently: a second wallet's key written over the first makes the
     * first wallet permanently unopenable, and the phrase is the only way back. A caller that
     * means to replace a wallet calls `clear()` first, which is the path "start over" and
     * restore-over-existing already take.
     */
    async storeEncryptionKey(key: string): Promise<void> {
      if (!key.trim()) throw new Error('Refusing to store an empty encryption key.');
      const existing = await storage.getItemAsync(KEY_ENCRYPTION);
      if (existing && existing !== key) {
        throw new Error('A wallet key is already stored. Clear the vault before storing another.');
      }
      await storage.setItemAsync(KEY_ENCRYPTION, key);
    },

    /** True when this install already has a wallet. */
    async has(): Promise<boolean> {
      return (await this.read()) !== null;
    },

    /**
     * Read the stored record, or null. A record that does not satisfy `isVaultRecord` is
     * treated as absent rather than repaired: guessing at the shape of key material is worse
     * than making the user restore from their phrase.
     */
    async read(): Promise<VaultRecord | null> {
      const raw = await storage.getItemAsync(KEY_RECORD);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isVaultRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    async write(record: Omit<VaultRecord, 'version'>): Promise<void> {
      const full: VaultRecord = { ...record, version: 1 };
      if (!isVaultRecord(full)) throw new Error('Refusing to store a malformed wallet record.');
      await storage.setItemAsync(KEY_RECORD, JSON.stringify(full));
    },

    /** Record that the user has written the phrase down. Until then, treat the wallet as unsafe. */
    async markBackedUp(when: number): Promise<void> {
      const record = await this.read();
      if (!record) throw new Error('There is no wallet to mark as backed up.');
      await this.write({ ...record, backedUpAt: when });
    },

    /**
     * Remove everything. Used by "start over" and by restore-over-existing.
     *
     * This is irreversible and the phrase is the only way back, so callers must confirm with
     * the user first — the vault cannot know whether they have it written down.
     */
    async clear(): Promise<void> {
      await storage.deleteItemAsync(KEY_RECORD);
      await storage.deleteItemAsync(KEY_ENCRYPTION);
    },
  };
}

export type WalletVault = ReturnType<typeof createWalletVault>;
