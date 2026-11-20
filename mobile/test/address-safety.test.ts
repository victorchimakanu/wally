import test from 'node:test';
import assert from 'node:assert/strict';
import { addressTrust, displayForm, trustWarning } from '../src/services/address-safety.ts';

/**
 * These decide whether someone is warned before paying an attacker, so the cases are written
 * as the attack rather than as the API.
 */

const REAL = '0xab12cd34ef567890abcdef1234567890abcd1234';
/** Same four leading and four trailing hex characters, different middle. The actual attack. */
const POISON = '0xab129999999999999999999999999999abcd1234';
const KNOWN = [{ address: REAL, label: 'Mum' }];

test('the attack: a poisoned address is indistinguishable once truncated', () => {
  // If these ever differ, the premise of this module is wrong and the test should be revisited.
  assert.equal(displayForm(REAL), displayForm(POISON));
  assert.notEqual(REAL.toLowerCase(), POISON.toLowerCase());
});

test('an address the user has actually used is trusted', () => {
  const trust = addressTrust(REAL, KNOWN);
  assert.equal(trust.kind, 'known');
  assert.equal(trust.kind === 'known' && trust.label, 'Mum');
  assert.equal(trustWarning(trust), null, 'a known address must not nag');
});

test('case and whitespace do not make a known address look new', () => {
  assert.equal(addressTrust(REAL.toUpperCase(), KNOWN).kind, 'known');
  assert.equal(addressTrust(`  ${REAL}  `, KNOWN).kind, 'known');
  // A checksummed address is the same address.
  assert.equal(addressTrust('0xAb12Cd34eF567890abcdef1234567890aBcd1234', KNOWN).kind, 'known');
});

test('a lookalike is caught, named, and explained', () => {
  const trust = addressTrust(POISON, KNOWN);
  assert.equal(trust.kind, 'lookalike');
  assert.equal(trust.kind === 'lookalike' && trust.resembles, REAL);

  const warning = trustWarning(trust)!;
  assert.match(warning, /Mum/, 'must say which entry it is impersonating');
  assert.match(warning, /different address/i);
  // It must not tell the user which one is right — it cannot know.
  assert.doesNotMatch(warning, /correct address is|use this one instead/i);
});

test('an ordinary new address is not treated as an attack', () => {
  const unrelated = '0x1111222233334444555566667777888899990000';
  const trust = addressTrust(unrelated, KNOWN);
  assert.equal(trust.kind, 'new');
  assert.equal(trustWarning(trust), null, 'warning fatigue is its own failure');
});

test('with nothing known, nothing can be a lookalike', () => {
  assert.equal(addressTrust(REAL, []).kind, 'new');
  assert.equal(addressTrust(POISON, []).kind, 'new');
});

test('an exact match wins even when another entry also resembles it', () => {
  // Order must not decide safety: the real address is trusted whichever way the list is read.
  const both = [{ address: POISON, label: 'Scammer' }, { address: REAL, label: 'Mum' }];
  assert.equal(addressTrust(REAL, both).kind, 'known');
  assert.equal(addressTrust(POISON, both).kind, 'known', 'a saved address is a deliberate choice');
});

test('empty or malformed input is never reported as trusted', () => {
  for (const bad of ['', '   ', '0x']) {
    assert.equal(addressTrust(bad, KNOWN).kind, 'new', `must not trust: "${bad}"`);
  }
});

test('addresses differing only in the hidden middle are the whole point', () => {
  const a = '0xdeadbeef00000000000000000000000000001111';
  const b = '0xdeadbeefffffffffffffffffffffffffffff1111';
  assert.equal(displayForm(a), displayForm(b));
  assert.equal(addressTrust(b, [{ address: a }]).kind, 'lookalike');
});
