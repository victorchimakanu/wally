/**
 * A random name this installation calls itself, so the backend can tell two phones apart.
 *
 * ## Why it exists
 *
 * The backend rate-limited on the client's network address and nothing else, and that is the
 * wrong unit for the people Wally is for. **Carrier-grade NAT is the norm on Nigerian mobile
 * networks**: many subscribers share one public address, so a per-address budget is divided
 * among strangers and the ones who arrive last get refused for doing nothing wrong. Sending an
 * id makes two phones behind one carrier address two budgets instead of half a budget each.
 *
 * ## What it is not
 *
 * **Not a credential, not a login, and not a defence.** The backend still limits per address
 * as a ceiling precisely because a client chooses what to send, and anything a client chooses
 * can be invented per request. This exists to stop honest users colliding with each other, not
 * to stop a dishonest one. `backend/src/ratelimit.ts` says the same thing from its side.
 *
 * ## What it must never become
 *
 * The backend holds no keys, no seeds and no personal data, and its logs carry a chain and a
 * method but never an address. This is the first identifier it has ever been given, so the
 * constraints are deliberate and worth keeping:
 *
 * - **Random, never derived from the device.** No advertising id, no hardware serial, nothing
 *   that survives reinstalling or follows the person to another app. A UUID from the platform
 *   random source and nothing else.
 * - **Never sent anywhere but Wally's own backend.** It rides on the existing header helper,
 *   which only attaches anything when a Wally proxy origin is configured.
 * - **Cleared when someone deletes their data.** It is declared in `app-data.ts` like every
 *   other key, so the wipe covers it and the build fails if that is ever forgotten.
 * - **Not a wallet identity.** It changes on reinstall and after a wipe, and nothing is keyed
 *   to it. Losing it costs a rate-limit window, nothing more.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const INSTALL_ID_KEY = 'wally.install.v1';
export const INSTALL_HEADER = 'x-wally-install';

/** The shape the backend accepts. Anything else is budgeted per address instead. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A v4 UUID from the platform's random source.
 *
 * `crypto.randomUUID` where it exists — Hermes exposes it on modern React Native, and the web
 * build has it on secure origins. The fallback uses `crypto.getRandomValues`, which is the
 * part that actually matters: a `Math.random` UUID would still work as a rate-limit key, but
 * writing that once invites someone to reuse this for something where it matters.
 */
function newId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  if (source && typeof source.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16));
    // Version 4, variant 1, per RFC 4122.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // No random source at all. Returning a predictable id would be worse than sending none: it
  // would put every such install into one shared budget, which is the bug this fixes.
  throw new Error('No secure random source for an installation id.');
}

/** Whether a stored value is usable, or has to be replaced. */
export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

let cached: string | null = null;
/** Set while a load is in flight, so a synchronous caller does not start one per request. */
let loading = false;

/**
 * This installation's id, creating one on first run.
 *
 * Returns null rather than throwing on any failure. The id is an optimisation in the user's
 * favour, and a phone that cannot store or generate one must still be able to use the app —
 * it simply falls back to being budgeted per address, which is where everyone was before.
 *
 * A stored value that is not a UUID is replaced rather than repaired. There is no partial
 * credit here: the backend refuses anything that is not exactly the shape, so sending a
 * salvaged half of one achieves nothing.
 */
export async function installId(): Promise<string | null> {
  if (cached) return cached;
  loading = true;
  try {
    const stored = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (isInstallId(stored)) { cached = stored; return cached; }
    const fresh = newId();
    await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    return null;
  } finally {
    loading = false;
  }
}

/**
 * The id if it is already in hand, without waiting.
 *
 * `backendHeaders` is synchronous and called on every request, so it cannot await a read from
 * storage. This returns null until the first load finishes, which costs the first request or
 * two the benefit and nothing else: an unidentified caller is budgeted per address, which is
 * where every caller was before this existed. It also starts the load if nothing has, so the
 * header appears by itself shortly after the app begins talking to the backend.
 */
export function currentInstallId(): string | null {
  if (!cached && !loading) void installId();
  return cached;
}

/**
 * Forget the cached id, for when storage has been wiped underneath us.
 *
 * Without this, deleting someone's data would clear the stored key while this module kept
 * handing out the old value for the rest of the session — the one way a "deleted" identifier
 * could keep being sent.
 */
export function forgetInstallId(): void {
  cached = null;
}
