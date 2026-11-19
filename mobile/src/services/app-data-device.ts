import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { clearStoredData, type Category, type ClearDeps, type ClearResult } from './app-data.ts';
import { loadSecureStorage } from './secure-storage.ts';
import { forgetInstallId } from './install-id.ts';

/**
 * `clearStoredData` bound to this phone's actual stores.
 *
 * Kept apart from `app-data.ts` so that the table and the deletion logic stay loadable in the
 * test runner: importing `react-native` at module scope makes a file unparseable there (see the
 * same note in `secure-storage.ts`). Everything worth testing is on the other side of this
 * file, and all this one does is say which stores are real.
 */
async function deps(): Promise<ClearDeps> {
  return {
    async: {
      getAllKeys: () => AsyncStorage.getAllKeys(),
      removeItem: key => AsyncStorage.removeItem(key),
    },
    // Null in a browser, where expo-secure-store has no implementation — so the keystore
    // entries are skipped rather than reported as undeletable. Nothing could have written
    // them there.
    secure: await loadSecureStorage(Platform.OS),
  };
}

/**
 * Delete everything in these categories from this phone.
 *
 * The installation id is held in memory as well as on disk, so the stored key going away is
 * not enough — this module would keep handing out the old value for the rest of the session,
 * which is the one way a deleted identifier could carry on being sent. Memory first, storage
 * second, exactly as the demo providers already require.
 */
export async function clearDeviceData(categories: readonly Category[]): Promise<ClearResult> {
  if (categories.includes('personal')) forgetInstallId();
  return clearStoredData(categories, await deps());
}

