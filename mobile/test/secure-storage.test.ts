import test from 'node:test';
import assert from 'node:assert/strict';
import { secureStorageAvailable, walletCapability, loadSecureStorage } from '../src/services/secure-storage.ts';

/**
 * These decide whether a device may hold real keys, so the failure direction matters: a wrong
 * "yes" puts key material somewhere it is not protected, a wrong "no" only costs a demo.
 */

test('only the platforms with a real keystore are allowed to hold a wallet', () => {
  assert.equal(secureStorageAvailable('ios'), true);
  assert.equal(secureStorageAvailable('android'), true);

  // expo-secure-store's web module is `export default {}` — every call throws. Answering yes
  // here would mean key material in localStorage, readable by any script on the page.
  assert.equal(secureStorageAvailable('web'), false);
  assert.equal(secureStorageAvailable('macos'), false);
  assert.equal(secureStorageAvailable('windows'), false);
});

test('an unsupported platform gets a reason, not just a refusal', () => {
  assert.deepEqual(walletCapability('android'), { kind: 'ready' });

  const web = walletCapability('web');
  assert.equal(web.kind, 'unsupported');
  // "cannot store keys safely" is a different claim from "unavailable", and the honest one.
  assert.match(web.reason!, /browser cannot store wallet keys safely/i);
  assert.match(web.reason!, /demo funds/i);

  const other = walletCapability('windows');
  assert.equal(other.kind, 'unsupported');
  assert.match(other.reason!, /no secure key storage/i);
});

test('loading the keystore on an unsupported platform returns null rather than throwing', async () => {
  // The caller falls back to the demo wallet. A throw here would crash the browser preview,
  // which is currently the only testing loop that works on this machine.
  assert.equal(await loadSecureStorage('web'), null);
  assert.equal(await loadSecureStorage('windows'), null);
});
