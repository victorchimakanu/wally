import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lockCapability, lockEnabled, unlockRequired, unlockPrompt, unlockFailureMessage,
  createLockPreference, type DeviceLock, type UnlockError,
} from '../src/services/app-lock.ts';

/**
 * This decides whether a stranger holding someone's unlocked phone can spend their money, so
 * the cases are the ones where it would be tempting to be accommodating: a phone with no lock,
 * a capability check that failed, a user who turned the lock off.
 */

const device = (over: Partial<DeviceLock> = {}): DeviceLock =>
  ({ hasHardware: true, isEnrolled: true, level: 'biometric', ...over });

test('a passcode counts, and a phone with nothing set up is told why', () => {
  assert.deepEqual(lockCapability(device()), { available: true, level: 'biometric' });

  // Weaker than a fingerprint, but a real secret the OS rate-limits. Refusing it would leave
  // older phones unprotected for no gain.
  assert.deepEqual(lockCapability(device({ level: 'passcode' })), { available: true, level: 'passcode' });

  // Hardware present but nothing enrolled: actionable, so the message says what to do.
  const unenrolled = lockCapability(device({ isEnrolled: false, level: 'none' }));
  assert.equal(unenrolled.available, false);
  assert.match(unenrolled.available === false ? unenrolled.reason : '', /none is set up yet/);

  // No lock at all. Saying this plainly is the point — believing you are protected when you
  // are not is worse than knowing you are not.
  const bare = lockCapability({ hasHardware: false, isEnrolled: false, level: 'none' });
  assert.equal(bare.available, false);
  assert.match(bare.available === false ? bare.reason : '', /no screen lock/);
});

test('the lock is on by default, and only the user can turn it off', () => {
  const able = lockCapability(device());

  // null means never chosen. Safe defaults matter most for people who never open settings.
  assert.equal(lockEnabled(able, null), true);
  assert.equal(lockEnabled(able, true), true);
  assert.equal(lockEnabled(able, false), false, 'an explicit off must be honoured');

  // A preference cannot switch on a lock the phone cannot perform — that would be a setting
  // that claims protection it does not deliver.
  const unable = lockCapability({ hasHardware: false, isEnrolled: false, level: 'none' });
  assert.equal(lockEnabled(unable, true), false);
  assert.equal(lockEnabled(unable, null), false);
});

test('unlockRequired tracks lockEnabled exactly, so there is one rule and not two', () => {
  // A second, subtly different rule for "must I ask" versus "is it on" is how a gate ends up
  // disabled in one place and not another.
  for (const d of [device(), device({ level: 'passcode' }), device({ isEnrolled: false, level: 'none' })]) {
    for (const preference of [null, true, false] as const) {
      const capability = lockCapability(d);
      assert.equal(unlockRequired(capability, preference), lockEnabled(capability, preference));
    }
  }
});

test('the prompt names what is about to happen', () => {
  // A bare "Authenticate" trains people to approve anything, and the value of this prompt is
  // that an unexpected one is a warning.
  assert.match(unlockPrompt('phrase'), /recovery phrase/i);
  assert.match(unlockPrompt('send', '0.5 ETH'), /0\.5 ETH/);
  assert.match(unlockPrompt('send'), /send/i);
  assert.doesNotMatch(unlockPrompt('send'), /undefined/);
});

test('every failure says what did not happen, and never implies money moved', () => {
  const errors: UnlockError[] = [
    'not_enrolled', 'user_cancel', 'app_cancel', 'not_available', 'lockout', 'no_space',
    'timeout', 'unable_to_process', 'unknown', 'system_cancel', 'user_fallback',
    'invalid_context', 'passcode_not_set', 'authentication_failed',
  ];
  for (const error of errors) {
    const sending = unlockFailureMessage(error, 'send');
    assert.match(sending, /Nothing was sent and your funds are untouched\./, `send/${error}`);
    // A failed check on a send screen is exactly when someone wonders whether their money
    // moved, so no message may hint that it did. Checked by removing the one sentence that is
    // allowed to say "sent" and requiring that nothing else does.
    const withoutDisclaimer = sending.replace('Nothing was sent and your funds are untouched.', '');
    assert.doesNotMatch(withoutDisclaimer, /\bsent\b|\bsending\b|\bsubmitted\b|\bbroadcast\b/i, `send/${error} must not imply a send`);

    const phrase = unlockFailureMessage(error, 'phrase');
    assert.match(phrase, /recovery phrase was not shown/, `phrase/${error}`);
  }

  // The OS imposing a lockout is it doing its job, and the message should not read as a Wally
  // fault the user can retry past.
  assert.match(unlockFailureMessage('lockout', 'send'), /your phone has locked this out/i);
});

test('the on/off choice round-trips, and an unset or damaged value reads as unset', () => {
  const items = new Map<string, string>();
  const preference = createLockPreference({
    async getItemAsync(k) { return items.get(k) ?? null; },
    async setItemAsync(k, v) { items.set(k, v); },
  });

  return (async () => {
    assert.equal(await preference.read(), null, 'never chosen must read as never chosen');

    await preference.write(false);
    assert.equal(await preference.read(), false);
    await preference.write(true);
    assert.equal(await preference.read(), true);

    // Anything unexpected reads as unset, so the default-on rule applies rather than a
    // garbled value silently disabling the lock.
    items.set('wally.appLock.v1', 'maybe');
    assert.equal(await preference.read(), null);
  })();
});

test('requireUnlock asks when the lock is on, and passes through when there is nothing to ask', async () => {
  const { requireUnlock } = await import('../src/services/unlock.ts');

  const deps = (over: Partial<Parameters<typeof requireUnlock>[2]> = {}) => {
    const prompts: string[] = [];
    return {
      prompts,
      deps: {
        async readDeviceLock() { return device(); },
        async readLockPreference() { return null; },
        async requestUnlock(prompt: string) { prompts.push(prompt); return { ok: true as const }; },
        ...over,
      },
    };
  };

  // Default on: a capable phone is asked, and the prompt names the amount.
  const asked = deps();
  assert.deepEqual(await requireUnlock('send', '0.5 ETH', asked.deps), { ok: true });
  assert.equal(asked.prompts.length, 1);
  assert.match(asked.prompts[0]!, /0\.5 ETH/);

  // Turned off by the user: no prompt.
  const off = deps({ async readLockPreference() { return false; } });
  assert.deepEqual(await requireUnlock('send', undefined, off.deps), { ok: true });
  assert.deepEqual(off.prompts, []);

  // No lock on the phone at all: nothing to ask, so it passes through rather than making the
  // wallet unusable. Not failing open — there is no protection to fail.
  const bare = deps({ async readDeviceLock() { return { hasHardware: false, isEnrolled: false, level: 'none' as const }; } });
  assert.deepEqual(await requireUnlock('phrase', undefined, bare.deps), { ok: true });
  assert.deepEqual(bare.prompts, []);

  // Refused: fails closed, with a message that says nothing moved.
  const refused = deps({ async requestUnlock() { return { ok: false as const, error: 'user_cancel' as const }; } });
  const outcome = await requireUnlock('send', undefined, refused.deps);
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok === false ? outcome.message : '', /Nothing was sent/);
});
