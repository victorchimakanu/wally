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
export type Preferences = { name: string; currency: string; saved: string[]; recipients: Recipient[] };

/** Bumped only when a change cannot be absorbed per-field below. */
export const PREFERENCES_VERSION = 1;

export const CURRENCIES = ['USD', 'NGN', 'EUR'] as const;
export const SAVEABLE = ['BTC', 'ETH', 'SOL', 'USDT'] as const;
const NETWORKS = ['Arbitrum', 'Ethereum'] as const;
const ADDRESS = /^0x[\da-fA-F]{40}$/;

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

  return { preferences: { name, currency, saved, recipients }, dropped };
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
