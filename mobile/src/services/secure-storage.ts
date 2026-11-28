import type { SecureStorage } from './wallet-vault.ts';

/**
 * The platform name, as `Platform.OS` reports it.
 *
 * Taken as a parameter rather than imported from react-native, because importing react-native
 * at module scope makes this file unloadable in the test runner: node cannot parse the Flow
 * types in react-native/index.js. Callers pass `Platform.OS`; tests pass a string. That keeps
 * the decision about whether a device may hold real keys under test, which is the point.
 */
export type OSName = 'ios' | 'android' | 'web' | 'macos' | 'windows' | string;

/**
 * Whether this device can hold a wallet at all.
 *
 * expo-secure-store has no web implementation — its web module is literally `export default {}`
 * (checked 31 Oct 2026), so every call throws. That is the correct behaviour for a wallet:
 * `localStorage` is not a keystore, and silently falling back to it would turn hardware-backed
 * key storage into something any script on the page can read, without anyone noticing.
 *
 * So the question has to be asked before the attempt. Where the answer is no, the app stays on
 * the demo wallet rather than pretending — see `walletCapability` below for the wording the UI
 * should use, because "unavailable" and "not secure here" are different claims and a user
 * deserves the second one.
 *
 */
export function secureStorageAvailable(os: OSName): boolean {
  return os === 'ios' || os === 'android';
}

export type WalletCapability =
  | { kind: 'ready' }
  | { kind: 'unsupported'; reason: string };

/** What the app may do here, and what to tell someone if the answer is no. */
export function walletCapability(os: OSName): WalletCapability {
  if (secureStorageAvailable(os)) return { kind: 'ready' };
  return {
    kind: 'unsupported',
    reason:
      os === 'web'
        ? 'A browser cannot store wallet keys safely, so this preview uses demo funds. Install the app to use a real wallet.'
        : 'This platform has no secure key storage, so this preview uses demo funds.',
  };
}

/**
 * The real keystore, or null where there is not one.
 *
 * Imported lazily so the module is never evaluated on a platform that cannot use it, and so a
 * web bundle does not fail at import time for a dependency it will never call.
 */
export async function loadSecureStorage(os: OSName): Promise<SecureStorage | null> {
  if (!secureStorageAvailable(os)) return null;
  const store = await import('expo-secure-store');
  return {
    getItemAsync: (key) => store.getItemAsync(key),
    // WHEN_UNLOCKED_THIS_DEVICE_ONLY: key material must not travel in an iCloud or
    // Google backup. Someone restoring a phone backup onto a new device should have to use
    // their recovery phrase, which is the thing they were told to write down — not silently
    // inherit a wallet along with their photos.
    setItemAsync: (key, value) =>
      store.setItemAsync(key, value, {
        keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    deleteItemAsync: (key) => store.deleteItemAsync(key),
  };
}
