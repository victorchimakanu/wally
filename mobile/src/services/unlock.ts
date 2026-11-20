/**
 * "Confirm it is you" — the one call every irreversible path makes.
 *
 * One function rather than a hook, because the two callers are not both React: the recovery
 * phrase screen is a component, and the live send path is inside the wallet provider's
 * `confirm()`. A hook would have forced the gate to live in whichever screen happened to host
 * the button, and a gate that each screen re-implements is a gate with a hole in it.
 *
 * Dependencies are injectable so the composition is testable; the defaults are the real
 * platform calls. The import of device-lock is extensionless on purpose — that is how Metro
 * picks the native implementation on a phone and the no-op on web.
 */
import {
  lockCapability, unlockRequired, unlockPrompt, unlockFailureMessage,
  type DeviceLock, type LockPurpose, type UnlockResult,
} from './app-lock.ts';

export type UnlockDeps = {
  readDeviceLock(): Promise<DeviceLock>;
  readLockPreference(): Promise<boolean | null>;
  requestUnlock(prompt: string): Promise<UnlockResult>;
};

/**
 * The real platform calls, loaded on first use.
 *
 * Imported lazily rather than at the top of the file for a boring but real reason: the
 * specifier has to be extensionless so Metro can pick `device-lock.native.ts` on a phone and
 * `device-lock.ts` on web, and an extensionless specifier is not resolvable by Node — which is
 * what runs the tests for the rules in this file. Keeping it inside the functions means the
 * composition is testable with injected fakes, which never reach this code at all.
 */
const real: UnlockDeps = {
  async readDeviceLock() { return (await import('./device-lock')).readDeviceLock(); },
  async readLockPreference() { return (await import('./device-lock')).readLockPreference(); },
  async requestUnlock(prompt) { return (await import('./device-lock')).requestUnlock(prompt); },
};

export type UnlockOutcome = { ok: true } | { ok: false; message: string };

/**
 * Ask, if asking is switched on. Returns a message to show when it is not satisfied.
 *
 * **Fails closed**, unlike the backend send gate in send-gate.ts, and the difference is
 * deliberate: that gate defends against our own bug and must not take the wallet down with the
 * backend, so it fails open. This one defends against a person holding someone else's phone,
 * and an unlock that could not be performed must never count as one. The cost of being wrong
 * here is a user who has to set up a screen lock; the cost of failing open is a stranger
 * spending their money.
 *
 * Where the phone genuinely cannot do it — no lock enrolled, or web — `unlockRequired` is false
 * and this passes through. That is not failing open: there is no protection to fail, and
 * refusing would leave such a user unable to use their wallet at all.
 */
export async function requireUnlock(
  purpose: LockPurpose,
  detail?: string,
  deps: UnlockDeps = real,
): Promise<UnlockOutcome> {
  const [device, preference] = await Promise.all([deps.readDeviceLock(), deps.readLockPreference()]);
  const capability = lockCapability(device);
  if (!unlockRequired(capability, preference)) return { ok: true };

  const result = await deps.requestUnlock(unlockPrompt(purpose, detail));
  if (result.ok) return { ok: true };
  return { ok: false, message: unlockFailureMessage(result.error, purpose) };
}
