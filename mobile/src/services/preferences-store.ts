/**
 * Reading saved preferences without throwing away the part that still makes sense.
 *
 * The address book lives in here. Until now the loader validated the whole object in one
 * expression and threw if any part of it failed, and the caller's catch fell back to defaults —
 * so a single malformed recipient, or any change to the shape of this record in a later
 * release, silently replaced every saved recipient with the three sample ones. The user saw
 * "Saved preferences could not be loaded" and their address book was gone.
 *
 * `FEATURE-AUDIT` §11.4 calls this "stored-data migration, partial". That undersells it: the
 * vault versions its record, and the thing holding the addresses people send money to did not
 * version anything at all.
 *
 * So: per field, not all-or-nothing. A bad currency costs the currency. A bad recipient costs
 * that recipient. Everything else survives, and the caller is told exactly what was dropped so
 * it can say so rather than pretending nothing happened.
 */

export type Recipient = { id: string; name: string; address: string; network: 'Arbitrum' | 'Ethereum' };
export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];
/** `appearance` is optional so records written before it existed read back unchanged; absent means system. */
export type Preferences = { name: string; currency: string; saved: string[]; recipients: Recipient[]; appearance?: Appearance };

/** Bumped only when a change cannot be absorbed per-field below. */
export const PREFERENCES_VERSION = 1;

export const CURRENCIES = ['USD', 'NGN', 'EUR'] as const;
export const SAVEABLE = ['BTC', 'ETH', 'SOL', 'USDT'] as const;
const NETWORKS = ['Arbitrum', 'Ethereum'] as const;
const ADDRESS = /^0x[\da-fA-F]{40}$/;

/**
 * The three worked examples the demo wallet ships with.
 *
 * Their addresses are `0x1111…`, `0x6666…` and `0x4444…`: valid, non-zero, and nobody holds a
 * key for any of them. Anything sent to one is gone — not refused, not reversible.
 *
 * That was fine while they existed only in the demo. They did not: `PreferencesProvider` is
 * mounted for the whole app, so on 19 Nov 2026 they were sitting in the address book of a
 * **live** wallet, two taps from a prefilled transfer — Wallet → Send → Saved → Victor → Send,
 * recipient already filled, nothing marking the entry as a sample. The name is a real
 * teammate's, and `addressTrust()` cannot help: an address in the address book is `known`,
 * which is the one verdict that suppresses the warning. The samples are trusted *because* they
 * are saved.
 *
 * Nothing was lost, because the dev wallet was empty. An empty balance is not a safeguard.
 */
export const SAMPLE_RECIPIENTS: readonly Recipient[] = [
  { id: 'victor', name: 'Victor', address: '0x' + '1'.repeat(40), network: 'Arbitrum' },
  { id: 'emmy', name: 'Emmy', address: '0x' + '6'.repeat(40), network: 'Ethereum' },
  { id: 'daniel', name: 'Daniel', address: '0x' + '4'.repeat(40), network: 'Arbitrum' },
];

/**
 * Drop the samples, for a wallet that can really spend.
 *
 * Matched on **id and address together**. Either alone would be wrong: a user is entitled to
 * save a real contact called Victor, and a user who edits a sample's address has made it their
 * own entry. Only an untouched sample goes.
 *
 * This runs on what was loaded from disk as well as on the defaults, because a device that ran
 * the demo first has the samples persisted and would otherwise carry them into live mode.
 */
export function withoutSampleRecipients(recipients: readonly Recipient[]): Recipient[] {
  return recipients.filter(entry => !SAMPLE_RECIPIENTS.some(
    sample => sample.id === entry.id && sample.address.toLowerCase() === entry.address.toLowerCase(),
  ));
}

export type LoadResult = {
  preferences: Preferences;
  /** What could not be read, in words, for the screen. Empty when everything loaded. */
  dropped: string[];
};

function isRecipient(value: unknown): value is Recipient {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64
    && typeof r.name === 'string' && r.name.length <= 60
    && typeof r.address === 'string' && ADDRESS.test(r.address)
    && typeof r.network === 'string' && (NETWORKS as readonly string[]).includes(r.network);
}

/**
 * Turn whatever is on disk into usable preferences.
 *
 * `defaults` supplies anything missing. Note what is *not* inherited: when the stored record
 * has a recipients array at all, its survivors are the answer even if that leaves none. A user
 * who deleted every saved recipient must not have the samples handed back to them on the next
 * launch.
 */
export function parsePreferences(raw: unknown, defaults: Preferences): LoadResult {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { preferences: defaults, dropped: raw === undefined || raw === null ? [] : ['everything saved on this device'] };
  }
  const data = raw as Record<string, unknown>;

  let name = defaults.name;
  if (typeof data.name === 'string' && data.name.length <= 40) name = data.name;
  else if (data.name !== undefined) dropped.push('your name');

  let currency = defaults.currency;
  if (typeof data.currency === 'string' && (CURRENCIES as readonly string[]).includes(data.currency)) currency = data.currency;
  else if (data.currency !== undefined) dropped.push('your chosen currency');

  let saved = defaults.saved;
  if (Array.isArray(data.saved)) {
    const good = data.saved.filter((s): s is string => typeof s === 'string' && (SAVEABLE as readonly string[]).includes(s));
    if (good.length !== data.saved.length) dropped.push('one or more watchlist assets');
    saved = good;
  } else if (data.saved !== undefined) dropped.push('your watchlist');

  let recipients = defaults.recipients;
  if (Array.isArray(data.recipients)) {
    const good = data.recipients.filter(isRecipient);
    if (good.length !== data.recipients.length) {
      const lost = data.recipients.length - good.length;
      dropped.push(lost === 1 ? '1 saved recipient' : `${lost} saved recipients`);
    }
    // Deliberately kept even when empty — see the note above.
    recipients = good;
  } else if (data.recipients !== undefined) {
    dropped.push('your saved recipients');
  }

  let appearance = defaults.appearance;
  if (typeof data.appearance === 'string' && (APPEARANCES as readonly string[]).includes(data.appearance)) appearance = data.appearance as Appearance;
  else if (data.appearance !== undefined) dropped.push('your appearance setting');

  return { preferences: { name, currency, saved, recipients, ...(appearance ? { appearance } : {}) }, dropped };
}

/** What to show when something was lost. Null when nothing was. */
export function droppedNotice(dropped: readonly string[]): string | null {
  if (!dropped.length) return null;
  return `Some saved settings could not be read and were reset: ${dropped.join(', ')}. Everything else was kept.`;
}

/** What gets written. The version is for changes that per-field reading cannot absorb. */
export function toStored(preferences: Preferences): unknown {
  return { version: PREFERENCES_VERSION, ...preferences };
}
