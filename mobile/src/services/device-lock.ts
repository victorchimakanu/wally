/**
 * Web has no biometric prompt and nothing worth protecting here.
 *
 * The browser preview runs on demo funds and holds no keys, so this reports no device lock.
 * `lockCapability()` turns that into "unavailable", which turns into "lock off" — so the
 * phrase and send paths are not blocked in the browser by a check that could never pass.
 *
 * `requestUnlock` still refuses rather than returning success. Nothing on web should be relying
 * on it, and a stub that said "yes" would be the kind of thing that survives into a native
 * build by accident.
 */
import type { DeviceLock, UnlockResult } from './app-lock.ts';

export async function readDeviceLock(): Promise<DeviceLock> {
  return { hasHardware: false, isEnrolled: false, level: 'none' };
}

export async function requestUnlock(_prompt: string): Promise<UnlockResult> {
  return { ok: false, error: 'not_available' };
}

export async function readLockPreference(): Promise<boolean | null> { return null; }
export async function writeLockPreference(_enabled: boolean): Promise<void> { /* nothing to store */ }
