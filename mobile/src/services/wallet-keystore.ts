/**
 * The bridge to the WDK Bare worklet that holds this wallet's keys.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *  UNVERIFIED ON A DEVICE. Every call below is written against the installed packages' own
 *  source, with the file and line noted, but none of it has ever executed: a Bare worklet
 *  needs a development build on a real phone, and this was written without one. Treat a
 *  failure here as "the integration was never run" before assuming the logic is wrong.
 *  The flow logic in recovery.ts and the storage in wallet-vault.ts *are* tested.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Why a worklet at all: keys must never reach the React Native JS thread (ADR-001). The
 * worklet generates the phrase, encrypts it and hands back only ciphertext plus the key it
 * chose. The phrase itself crosses the boundary exactly twice — once when it is first shown
 * for the user to write down, and again if they ask to see it later. There is no third path.
 *
 * Verified against the installed source, not from memory:
 *
 *   generateEntropyAndEncrypt({ wordCount })      pear-wrk-wdk src/handlers/secrets.js:18
 *     → { encryptionKey, encryptedSeedBuffer, encryptedEntropyBuffer }, all Buffers
 *       (src/utils/crypto.js:147 — the key is crypto.randomBytes(32), chosen in the worklet)
 *   getSeedAndEntropyFromMnemonic({ mnemonic })   secrets.js:91 — same shape, and it runs
 *     validateMnemonic, so the BIP-39 checksum is checked there rather than here
 *   getMnemonicFromEntropy({ encryptedEntropy, encryptionKey })  secrets.js:50 → { mnemonic }
 *   initializeWDK({ encryptionKey, encryptedSeed, config })      README "WDK Lifecycle"
 *   callMethod({ methodName, network, accountIndex, args })      README "Wallet Interaction"
 *   new Worklet(); worklet.start(name, source); worklet.IPC; worklet.terminate()
 *     react-native-bare-kit index.d.ts:21-37
 *
 * Everything the worklet and the RPC client need is injected, so the sequencing below — which
 * is the part that can corrupt a wallet — is testable with fakes and no native code.
 */
import { fromBase64, toBase64, type WalletVault } from './wallet-vault.ts';
import { PHRASE_WORDS, phraseShape } from './recovery.ts';

/**
 * Bytes, in both directions.
 *
 * The worklet's own types say Buffer (pear-wrk-wdk types/rpc.d.ts:189), and its handlers check
 * `Buffer.isBuffer` — but React Native has no Buffer, and it does not need one: the HRPC wire
 * format encodes a buffer field through compact-encoding's `uint8array` codec and decodes it
 * with `subarray`, so a Uint8Array sent from here arrives inside the Bare runtime as a real
 * Buffer. A Buffer coming back the other way *is* a Uint8Array, so this type covers both.
 */
export type WorkletBuffer = Uint8Array;

export type EncryptedSecrets = {
  encryptionKey: WorkletBuffer;
  encryptedSeedBuffer: WorkletBuffer;
  encryptedEntropyBuffer: WorkletBuffer;
};

/** Only the calls Wally makes. Narrower than the worklet's surface, on purpose. */
export type WorkletRpc = {
  generateEntropyAndEncrypt(params: { wordCount: 12 | 24 }): Promise<EncryptedSecrets>;
  getSeedAndEntropyFromMnemonic(params: { mnemonic: string }): Promise<EncryptedSecrets>;
  getMnemonicFromEntropy(params: { encryptedEntropy: WorkletBuffer; encryptionKey: WorkletBuffer }): Promise<{ mnemonic: string }>;
  initializeWDK(params: { encryptionKey: WorkletBuffer; encryptedSeed: WorkletBuffer; config: string }): Promise<unknown>;
  /**
   * Synchronous, and it takes an argument — omitting `blockchains` disposes the whole WDK
   * instance, which is what "forget this wallet" means (pear-wrk-wdk types/hrpc/hrpc.d.ts:75,
   * types/rpc.d.ts:24).
   */
  dispose(params: { blockchains?: string[] }): void;
};

export type KeystoreDeps = {
  /** Opens the worklet and returns a client for it. Called at most once per keystore. */
  connect(): Promise<{ rpc: WorkletRpc; close(): void }>;
  /**
   * The JSON WDK config (networks, RPC urls and, where available, the bundler and paymaster),
   * already stringified. Async because whether gasless is available is something only the
   * backend can answer.
   */
  config(): Promise<string>;
};

/** Ciphertext is stored as base64 text, because that is what the OS keystore takes. */
function encode(buffer: WorkletBuffer): string {
  return toBase64(buffer);
}

export function createKeystore(vault: WalletVault, deps: KeystoreDeps) {
  let open: { rpc: WorkletRpc; close(): void } | null = null;

  async function rpc(): Promise<WorkletRpc> {
    open ??= await deps.connect();
    return open.rpc;
  }

  /**
   * Persist a freshly produced set of secrets.
   *
   * The order matters more than it looks. A key stored without its record is debris that
   * would make the *next* attempt fail — `storeEncryptionKey` refuses a different key over an
   * existing one, precisely so a second wallet cannot orphan the first — so a setup that died
   * halfway would wedge the install permanently. Clearing first makes a retry work, and is
   * safe only because this is reached solely when there is no wallet to lose.
   */
  async function persist(secrets: EncryptedSecrets, wordCount: number): Promise<void> {
    if (await vault.has()) {
      throw new Error('This device already has a wallet. Start over first if you mean to replace it.');
    }
    await vault.clear();
    await vault.storeEncryptionKey(encode(secrets.encryptionKey));
    await vault.write({
      encryptedEntropy: encode(secrets.encryptedEntropyBuffer),
      encryptedSeed: encode(secrets.encryptedSeedBuffer),
      wordCount,
      // Never pre-confirmed. Sending stays blocked until the user tells us they wrote it down.
      backedUpAt: 0,
    });
  }

  return {
    /**
     * Make a new wallet and return its phrase, once, for the user to write down.
     *
     * The caller must drop the string as soon as the screen is done with it. It cannot be
     * zeroed — JS strings are immutable, which the worklet's own handler notes as a known
     * accepted gap — so the only control available is not keeping it.
     */
    async create(): Promise<{ mnemonic: string }> {
      const client = await rpc();
      const secrets = await client.generateEntropyAndEncrypt({ wordCount: PHRASE_WORDS });
      await persist(secrets, PHRASE_WORDS);
      // Read back through the same path "show it again" uses, rather than returning a phrase
      // held from generation. If reveal is broken, it fails now — while the wallet is still
      // empty — instead of the first time someone needs their phrase.
      return { mnemonic: await this.reveal() };
    },

    /** Bring an existing wallet in. The worklet validates the checksum; shape is checked first. */
    async restore(rawPhrase: string): Promise<void> {
      const shape = phraseShape(rawPhrase);
      if (!shape.ok) throw new Error(shape.reason);
      const client = await rpc();
      const secrets = await client.getSeedAndEntropyFromMnemonic({ mnemonic: shape.words.join(' ') });
      await persist(secrets, shape.words.length);
      // A restored wallet is backed up by definition: the user just proved they have the
      // phrase by typing it. Making them write down what they read off paper would be
      // theatre, and it would block sending for no gain.
      await vault.markBackedUp(Date.now());
    },

    /** Decrypt and return the phrase for display. */
    async reveal(): Promise<string> {
      const record = await vault.read();
      const key = await vault.encryptionKey();
      if (!record || !key) throw new Error('There is no wallet on this device.');
      const client = await rpc();
      const { mnemonic } = await client.getMnemonicFromEntropy({
        encryptedEntropy: fromBase64(record.encryptedEntropy),
        encryptionKey: fromBase64(key),
      });
      return mnemonic;
    },

    /** Boot WDK inside the worklet so addresses and signing become available. */
    async unlock(): Promise<void> {
      const record = await vault.read();
      const key = await vault.encryptionKey();
      if (!record || !key) throw new Error('There is no wallet on this device.');
      const client = await rpc();
      await client.initializeWDK({
        encryptionKey: fromBase64(key),
        encryptedSeed: fromBase64(record.encryptedSeed),
        config: await deps.config(),
      });
    },

    /** Record that the user has written the phrase down. This is what unblocks sending. */
    async confirmBackedUp(): Promise<void> {
      await vault.markBackedUp(Date.now());
    },

    /**
     * Destroy this wallet on this device.
     *
     * Irreversible, and the phrase is the only way back, so every caller confirms with the
     * user first — the keystore cannot know whether they have it written down. The worklet is
     * disposed before the vault is cleared so a live WDK instance is not left holding keys for
     * a wallet the device no longer has.
     */
    async forget(): Promise<void> {
      if (open) {
        try { open.rpc.dispose({}); } catch { /* tearing down regardless */ }
        try { open.close(); } catch { /* ditto */ }
        open = null;
      }
      await vault.clear();
    },
  };
}

export type Keystore = ReturnType<typeof createKeystore>;
