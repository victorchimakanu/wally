/**
 * Whether Wally asks for a fingerprint, a face or the device passcode before it does something
 * that cannot be undone.
 *
 * What it guards, and what it deliberately does not:
 *
 *   revealing the recovery phrase   always asks
 *   signing a transfer              always asks, however recently you unlocked
 *   balances, receiving, Activity   never ask
 *
 * Checking whether money arrived should cost nothing. The two things worth a prompt are the
 * secret and the irreversible action, and a wallet people avoid opening is one they stop using.
 *
 * **There is no Wally PIN, on purpose.** `expo-local-authentication`'s `authenticateAsync`
 * already falls back to the device passcode after failed biometric attempts —
 * `disableDeviceFallback` defaults to `false`, verified in the installed
 * LocalAuthentication.types.d.ts. Building our own PIN would mean storing a PIN hash,
 * rate-limiting guesses and handling resets: duplicating, worse, what the OS does well. On a
 * phone with no lock at all the honest answer is that this cannot protect anything, so it says
 * so rather than pretending.
 *
 * Everything here is pure. The native calls live in device-lock.native.ts so that these rules
 * — the part that decides whether a spend is allowed through — are testable without a device.
 */

/** What the OS reports. `level` mirrors expo-local-authentication's SecurityLevel. */
export type DeviceLock = {
  hasHardware: boolean;
  isEnrolled: boolean;
  level: 'none' | 'passcode' | 'biometric';
};

export type LockCapability =
  | { available: true; level: 'passcode' | 'biometric' }
  | { available: false; reason: string };

/**
 * Can this phone back an app lock at all?
 *
 * A passcode counts. It is weaker than a fingerprint but it is a real secret the OS
 * rate-limits, and refusing it would leave people with older phones unprotected for no gain.
 */
export function lockCapability(device: DeviceLock): LockCapability {
  if (device.level === 'biometric' && device.isEnrolled) return { available: true, level: 'biometric' };
  if (device.level === 'passcode') return { available: true, level: 'passcode' };
  if (device.hasHardware && !device.isEnrolled) {
    return {
      available: false,
      reason: 'This phone can use a fingerprint or face, but none is set up yet. Add one in your phone’s settings, then come back.',
    };
  }
  return {
    available: false,
    // Said plainly. A lock Wally invents on a phone with no lock screen is theatre, and
    // believing you are protected when you are not is worse than knowing you are not.
    reason: 'This phone has no screen lock, so Wally has nothing to check you against. Set a passcode, fingerprint or face unlock in your phone’s settings first.',
  };
}

/**
 * Is the lock on?
 *
 * **On by default wherever the phone can support it.** A safe default matters most for the
 * people least likely to go looking through settings, and this is money. `preference` is null
 * when the user has never chosen, in which case the default applies.
 */
export function lockEnabled(capability: LockCapability, preference: boolean | null): boolean {
  if (!capability.available) return false;
  return preference ?? true;
}

export type LockPurpose = 'phrase' | 'send';

/**
 * The sentence shown in the system prompt.
 *
 * It names what is about to happen, because a bare "Authenticate" prompt trains people to
 * approve anything — and the whole value of this prompt is that an unexpected one is a warning.
 */
export function unlockPrompt(purpose: LockPurpose, detail?: string): string {
  if (purpose === 'phrase') return 'Confirm it is you before showing your recovery phrase';
  return detail ? `Confirm it is you to send ${detail}` : 'Confirm it is you to send this transfer';
}

/** The error values expo-local-authentication can return. */
export type UnlockError =
  | 'not_enrolled' | 'user_cancel' | 'app_cancel' | 'not_available' | 'lockout' | 'no_space'
  | 'timeout' | 'unable_to_process' | 'unknown' | 'system_cancel' | 'user_fallback'
  | 'invalid_context' | 'passcode_not_set' | 'authentication_failed';

export type UnlockResult = { ok: true } | { ok: false; error: UnlockError };

/**
 * What to tell the user when the check did not pass.
 *
 * Every message says what was *not* done and that their money is untouched, which is the house
 * style for failures here and matters more than usual: a failed check on a send screen is a
 * moment someone will reasonably wonder whether their money moved.
 */
export function unlockFailureMessage(error: UnlockError, purpose: LockPurpose): string {
  const nothingHappened = purpose === 'send'
    ? 'Nothing was sent and your funds are untouched.'
    : 'Your recovery phrase was not shown.';

  switch (error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
    case 'user_fallback':
      return `Cancelled. ${nothingHappened}`;
    case 'authentication_failed':
    case 'unable_to_process':
      return `That did not match. ${nothingHappened} You can try again.`;
    case 'lockout':
      // The OS, not Wally, imposes this — and it is doing its job.
      return `Too many attempts, so your phone has locked this out for a while. ${nothingHappened} Unlock your phone the usual way and try again.`;
    case 'timeout':
      return `The check timed out. ${nothingHappened}`;
    case 'not_enrolled':
    case 'passcode_not_set':
      return `Your phone no longer has a screen lock set up, so Wally cannot check it is you. ${nothingHappened} Set one up in your phone’s settings.`;
    case 'not_available':
      return `This phone cannot check it is you. ${nothingHappened}`;
    case 'no_space':
      return `Your phone is out of storage, so the check could not run. ${nothingHappened}`;
    case 'invalid_context':
    case 'unknown':
    default:
      return `The check could not be completed. ${nothingHappened}`;
  }
}

/**
 * Whether an action may proceed.
 *
 * Deliberately **fails closed**, which is the opposite of the send gate in send-gate.ts, and
 * the difference is worth stating. That gate protects against *our* bug and an app which cannot
 * reach the backend must still work, so it fails open. This one protects against a person
 * holding someone else's phone — and an unlock that cannot be performed must not count as an
 * unlock, or the protection is nothing. The cost of being wrong here is a user who has to set
 * up a screen lock; the cost of failing open is a stranger spending their money.
 */
export function unlockRequired(capability: LockCapability, preference: boolean | null): boolean {
  return lockEnabled(capability, preference);
}

const PREFERENCE_KEY = 'wally.appLock.v1';

type PreferenceStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
};

/**
 * Where the on/off choice lives: the OS keystore, beside the wallet.
 *
 * Not ordinary app storage. "App lock is off" is a security-relevant claim, and somewhere an
 * attacker with the handset could flip it is the wrong place for it.
 */
export function createLockPreference(storage: PreferenceStorage) {
  return {
    /** null when the user has never chosen, so the default-on rule applies. */
    async read(): Promise<boolean | null> {
      const stored = await storage.getItemAsync(PREFERENCE_KEY);
      if (stored === 'on') return true;
      if (stored === 'off') return false;
      return null;
    },
    async write(enabled: boolean): Promise<void> {
      await storage.setItemAsync(PREFERENCE_KEY, enabled ? 'on' : 'off');
    },
  };
}
