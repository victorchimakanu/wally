/**
 * The actual biometric / passcode prompt.
 *
 * Verified against the installed expo-local-authentication rather than from memory:
 *   hasHardwareAsync(), isEnrolledAsync()            LocalAuthentication.d.ts:8,22
 *   getEnrolledLevelAsync() -> SecurityLevel          :30  (NONE=0, SECRET=1, BIOMETRIC=2)
 *   authenticateAsync(options) -> { success } | { success, error }   :40
 *   disableDeviceFallback defaults to false, so the system falls back to the device
 *   passcode after failed biometric attempts — which is why Wally has no PIN of its own
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import type { DeviceLock, UnlockError, UnlockResult } from './app-lock.ts';
import { createLockPreference } from './app-lock.ts';
import { loadSecureStorage } from './secure-storage.ts';

export async function readDeviceLock(): Promise<DeviceLock> {
  try {
    const [hasHardware, isEnrolled, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    return {
      hasHardware,
      isEnrolled,
      level: level === LocalAuthentication.SecurityLevel.BIOMETRIC ? 'biometric'
        : level === LocalAuthentication.SecurityLevel.SECRET ? 'passcode'
        : 'none',
    };
  } catch {
    // Reporting "no lock" on failure makes lockCapability() unavailable, which turns the lock
    // off rather than leaving the user unable to use their wallet. That is the one place this
    // feature may fail open: it is a capability check, not the check itself.
    return { hasHardware: false, isEnrolled: false, level: 'none' };
  }
}

export async function requestUnlock(prompt: string): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      // Left at its default of false on purpose: after failed biometric attempts the system
      // offers the device passcode, which is the fallback Wally would otherwise have to build.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
      // Android only, and the stricter of the two classes. A camera-based face unlock that a
      // photograph can satisfy is not what should stand between someone and a transfer.
      ...(Platform.OS === 'android' ? { biometricsSecurityLevel: 'strong' as const } : {}),
    });
    if (result.success) return { ok: true };
    return { ok: false, error: (result.error as UnlockError) ?? 'unknown' };
  } catch {
    // An exception is not an unlock. This path fails closed, unlike the capability check above.
    return { ok: false, error: 'unknown' };
  }
}

async function preference() {
  const storage = await loadSecureStorage(Platform.OS);
  return storage ? createLockPreference(storage) : null;
}

export async function readLockPreference(): Promise<boolean | null> {
  return (await preference())?.read() ?? null;
}

export async function writeLockPreference(enabled: boolean): Promise<void> {
  await (await preference())?.write(enabled);
}
