/**
 * Everything Wally stores on this phone, declared in one place, so that "delete my data" can
 * be a complete answer rather than a hopeful one.
 *
 * This exists because `forget()` did not do what the screen calling it said. "Remove this
 * wallet from this phone" deleted the two keystore entries and left the chat history, the
 * address book and a cache of the wallet's own addresses sitting in ordinary app storage
 * (FEATURE-AUDIT §11). Someone who sells the handset, or hands it to a relative, taps that
 * button and is told it cannot be undone — and leaves every message and every saved recipient
 * behind.
 *
 * The failure was structural, not a missing line: nothing in the codebase knew the full list.
 * Each feature chose its own key next to the code that used it, which is the right place to
 * *use* a key and the wrong place to be the only record of it. So the list lives here, and
 * `test/app-data.test.ts` reads every source file for a `wally.*` literal and fails if one is
 * not in this table. Adding storage without declaring it breaks the build, which is the only
 * version of this guarantee that survives the next feature.
 *
 * Note what this file deliberately does *not* do: it does not delete keys. Key removal has to
 * tear down the worklet holding them as well, so it stays in `wallet-keystore.ts`. The keys
 * are listed here all the same, because the table's other job is to be the complete answer to
 * "what is on this phone", and a list of personal data that omits the wallet is a lie of a
 * different kind.
 */

/** Which store holds it. The OS keystore and ordinary app storage are different places. */
export type Store = 'secure' | 'async';

/**
 * What kind of thing it is, which is what decides whether a wipe takes it.
 *
 * - `keys`     the wallet itself. Removed by `wallet-keystore.ts`, never from here.
 * - `personal` about this user: what they said, who they send to, what they hold, how they
 *              chose to protect it, what phone they are on.
 * - `cache`    public data that happens to be saved locally. Market prices are the same for
 *              everyone on earth; deleting them protects nobody and costs a slow first screen.
 */
export type Category = 'keys' | 'personal' | 'cache';

/**
 * A stable name for one entry, so that code wanting to delete one specific thing can ask for
 * it without naming its storage key. "Clear chat history" needs exactly one entry; writing
 * 'wally.frontend-demo.v1' at that call site would give the key a second home, which is the
 * drift this file exists to prevent.
 */
export type DataId =
  | 'wallet-key' | 'wallet-record'
  | 'chats' | 'preferences' | 'wallet-cache' | 'app-lock' | 'benchmark'
  | 'prices' | 'charts';

export type StoredData = {
  id: DataId;
  /** The storage key, or the start of it where the key carries a variable. */
  key: string;
  /** False when `key` is a prefix — the real keys are found by listing the store. */
  exact: boolean;
  store: Store;
  category: Category;
  /**
   * What to call it on a confirmation screen.
   *
   * Written for someone deciding whether to press the button, so it names the content and not
   * the mechanism: "Your chat history", never "wally.frontend-demo.v1". A person cannot
   * consent to a storage key.
   */
  label: string;
  /** Where it is written, so the next person can find the code behind an entry. */
  owner: string;
};

export const STORED_DATA: readonly StoredData[] = [
  // The wallet. Listed, never deleted from here — see the note at the top of this file.
  { id: 'wallet-key', key: 'wally.wallet.encryptionKey.v1', exact: true, store: 'secure', category: 'keys',
    label: 'The key that unlocks your wallet', owner: 'services/wallet-vault.ts' },
  { id: 'wallet-record', key: 'wally.wallet.record.v1', exact: true, store: 'secure', category: 'keys',
    label: 'Your encrypted recovery phrase', owner: 'services/wallet-vault.ts' },

  // Personal.
  { id: 'chats', key: 'wally.frontend-demo.v1', exact: true, store: 'async', category: 'personal',
    label: 'Your chat history', owner: 'demo/store.tsx' },
  { id: 'preferences', key: 'wally.frontend-preferences.v1', exact: true, store: 'async', category: 'personal',
    label: 'Your saved recipients, name and currency', owner: 'demo/preferences.tsx' },
  // Prefix: the endpoint is part of the key, so a developer pointing at a second wallet server
  // leaves a second cache behind. Both are this user's addresses and both have to go.
  { id: 'wallet-cache', key: 'wally.testnet.wallet.v1.', exact: false, store: 'async', category: 'personal',
    label: 'Your saved balances and wallet addresses', owner: 'data/wallet.tsx' },
  { id: 'app-lock', key: 'wally.appLock.v1', exact: true, store: 'secure', category: 'personal',
    label: 'Whether app lock is switched on', owner: 'services/app-lock.ts' },
  { id: 'benchmark', key: 'wally.phone-benchmark.v1', exact: true, store: 'async', category: 'personal',
    label: 'The speed test for this phone', owner: 'screens/PhonePerformance.tsx' },

  // Public data that is merely cached here.
  { id: 'prices', key: 'wally.market.v1.', exact: false, store: 'async', category: 'cache',
    label: 'Saved prices', owner: 'data/market.tsx' },
  { id: 'charts', key: 'wally.chart.v1.', exact: false, store: 'async', category: 'cache',
    label: 'Saved price charts', owner: 'data/market.tsx' },
];

/** Does this entry claim this key? */
export function owns(entry: StoredData, key: string): boolean {
  return entry.exact ? key === entry.key : key.startsWith(entry.key);
}

/** The entries in these categories, in table order. */
export function inCategories(categories: readonly Category[]): StoredData[] {
  return STORED_DATA.filter(entry => categories.includes(entry.category));
}

/**
 * What a wipe of these categories would delete, in words, without duplicates.
 *
 * For the confirmation screen. A destructive button that does not say what it destroys is how
 * people press it by mistake, and a list written from the same table that performs the delete
 * cannot drift from what actually happens.
 */
export function describeStoredData(categories: readonly Category[]): string[] {
  const labels: string[] = [];
  for (const entry of inCategories(categories)) if (!labels.includes(entry.label)) labels.push(entry.label);
  return labels;
}

/** One declared entry by name. Throws, because an unknown id is a programming error. */
export function entryFor(id: DataId): StoredData {
  const entry = STORED_DATA.find(item => item.id === id);
  if (!entry) throw new Error(`No stored data is declared under the id "${id}".`);
  return entry;
}

/**
 * The real keys to delete, resolved against what the store actually holds.
 *
 * Prefix entries need this: nothing can delete `wally.market.v1.NGN` without first asking
 * which currencies this phone has seen.
 */
export function resolveKeys(entries: readonly StoredData[], existing: readonly string[]): string[] {
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.exact) { keys.push(entry.key); continue; }
    for (const key of existing) if (owns(entry, key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export type AsyncStore = {
  getAllKeys(): Promise<readonly string[]>;
  removeItem(key: string): Promise<void>;
};

export type SecureStore = {
  deleteItemAsync(key: string): Promise<void>;
};

export type ClearDeps = {
  async: AsyncStore;
  /** Null where the platform has no keystore — a browser. Its entries are then skipped. */
  secure: SecureStore | null;
};

export type ClearResult = {
  /** Storage keys actually removed. */
  removed: string[];
  /** What is still there, in the same words the confirmation used. */
  kept: { label: string; reason: string }[];
};

/** Delete everything in these categories. See `clearEntries` for how refusals are handled. */
export async function clearStoredData(
  categories: readonly Category[],
  deps: ClearDeps,
): Promise<ClearResult> {
  return clearEntries(inCategories(categories), deps);
}

/**
 * Delete these specific entries, and report truthfully on what survived.
 *
 * `clearStoredData` is this with the entries chosen by category. Both go through here so that
 * "remove this wallet" and "clear chat history" cannot deal with a refusal differently.
 *
 * Four decisions worth keeping:
 *
 * **Keys are refused.** An entry in the `keys` category is skipped however it was asked for.
 * Removing the wallet has to tear down the worklet holding it open as well, so that belongs in
 * `wallet-keystore.ts`; deleting the key material from under it here would leave a live handle
 * to a wallet that no longer exists.
 *
 * **Every entry is attempted, independently.** An early return on the first failure would
 * leave the rest in place while the caller believed the wipe had run. One keystore throwing
 * must not save the chat history.
 *
 * **A failure is reported by label, not by key.** The caller shows this to a person, who needs
 * to be told "your chat history could not be deleted" and not a key name they have never seen.
 *
 * **It does not throw.** A wipe that fails halfway has still done something, and an exception
 * carries no account of what. The result is the account.
 */
export async function clearEntries(
  asked: readonly StoredData[],
  deps: ClearDeps,
): Promise<ClearResult> {
  const result: ClearResult = { removed: [], kept: [] };
  const entries = asked.filter(entry => entry.category !== 'keys');
  const prefixed = entries.filter(entry => !entry.exact && entry.store === 'async');

  // Prefix entries cannot be resolved without knowing what the store holds, so the listing is
  // asked for once. If it fails, those entries are reported as kept and the exact ones still
  // run — a listing this phone will not give is no reason to leave the chat history behind.
  let existing: readonly string[] = [];
  let listed = true;
  if (prefixed.length) {
    try { existing = await deps.async.getAllKeys(); }
    catch (failure) {
      listed = false;
      for (const entry of prefixed) result.kept.push({ label: entry.label, reason: reason(failure) });
    }
  }

  for (const entry of entries) {
    if (entry.store === 'secure' && !deps.secure) continue;  // No keystore here; nothing stored.
    if (!listed && prefixed.includes(entry)) continue;       // Already reported above.

    for (const key of resolveKeys([entry], existing)) {
      try {
        if (entry.store === 'secure') await deps.secure!.deleteItemAsync(key);
        else await deps.async.removeItem(key);
        result.removed.push(key);
      } catch (failure) {
        if (!result.kept.some(kept => kept.label === entry.label)) result.kept.push({ label: entry.label, reason: reason(failure) });
      }
    }
  }

  return result;
}

function reason(failure: unknown): string {
  return failure instanceof Error && failure.message ? failure.message : 'This phone refused the deletion.';
}
