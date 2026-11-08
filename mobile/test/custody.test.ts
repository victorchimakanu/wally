import test from 'node:test';
import assert from 'node:assert/strict';
import {
  custodyOf, custodyNotice, moneySource, protectsDisplayedFunds, spendAllowed,
  type Custody,
} from '../src/services/custody.ts';

/**
 * Wally has two wallets. The recovery flow creates one in the OS keystore; balances, addresses
 * and sending come from a dev server holding its own seed on a developer's computer.
 *
 * These tests exist for one failure: an app showing one wallet's money while offering to back
 * up another wallet's phrase. A user who writes down their words has not backed up what is on
 * their screen, and a user who funds the address on Receive has funded a wallet those words
 * cannot recover.
 */

const of = (keystoreWallet: boolean, devServerConfigured: boolean, splitPermitted = false) =>
  custodyOf({ keystoreWallet, devServerConfigured, splitPermitted });

test('the four states, and which one is dangerous', () => {
  assert.deepEqual(of(false, false), { kind: 'none' });
  assert.deepEqual(of(true, false), { kind: 'device' });
  assert.deepEqual(of(false, true), { kind: 'dev-server' });
  assert.deepEqual(of(true, true), { kind: 'split', permitted: false });
  assert.deepEqual(of(true, true, true), { kind: 'split', permitted: true });
});

test('a split that nobody opted into shows nothing at all', () => {
  // The decision: refuse rather than label. A build that cannot open the wallet on this phone
  // must not quietly display a different wallet's balances and receive address instead.
  assert.equal(moneySource(of(true, true)), 'blocked');
  assert.match(custodyNotice(of(true, true))!, /cannot open the wallet stored on this phone/);
  assert.match(custodyNotice(of(true, true))!, /will not show you a different wallet/);
});

test('the opt-in changes what is shown and never what is true', () => {
  const permitted = of(true, true, true);
  assert.equal(moneySource(permitted), 'dev-server', 'a developer may proceed');
  assert.equal(protectsDisplayedFunds(permitted), false, 'the phrase still protects nothing here');
  const notice = custodyNotice(permitted)!;
  assert.match(notice, /different wallet/);
  assert.match(notice, /does not protect this money/);
  assert.match(notice, /Do not send real funds/);
});

test('only a device wallet is protected by the phrase the app can show', () => {
  assert.equal(protectsDisplayedFunds(of(true, false)), true);
  assert.equal(protectsDisplayedFunds(of(false, true)), false, 'dev server: no phrase exists here');
  assert.equal(protectsDisplayedFunds(of(false, false)), false, 'demo: nothing real to protect');
  assert.equal(protectsDisplayedFunds(of(true, true)), false);
  assert.equal(protectsDisplayedFunds(of(true, true, true)), false);
});

test('a notice appears exactly when the phrase does not protect real money on screen', () => {
  // The invariant that keeps the warning and the state from drifting apart.
  for (const custody of [of(false, false), of(true, false), of(false, true), of(true, true), of(true, true, true)] as Custody[]) {
    const notice = custodyNotice(custody);
    const realFunds = moneySource(custody) !== 'demo';
    const safe = protectsDisplayedFunds(custody);
    if (realFunds && !safe) assert.ok(notice, `${custody.kind} shows real funds the phrase does not protect and says nothing`);
    if (safe) assert.equal(notice, null, `${custody.kind} is safe and should not warn`);
  }
  assert.equal(custodyNotice(of(false, false)), null, 'demo funds are already labelled fictional');
});

// ── The mis-wiring this module exists to make impossible ──────────────────────────────────────

test('a backed-up device wallet may spend, and knows it is protected', () => {
  const decision = spendAllowed(of(true, false), { backedUpAt: 1762500000000 });
  assert.deepEqual(decision, { allowed: true, protectedByBackup: true });
});

test('a device wallet with no backup cannot spend', () => {
  const decision = spendAllowed(of(true, false), { backedUpAt: 0 });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.action, 'back-up');
  assert.match(decision.allowed === false ? decision.reason : '', /Write down your recovery phrase/);
});

test('a confirmed backup NEVER unlocks spending in a refused split', () => {
  // This is the bug. spendAllowed used to take the vault record alone, so wiring it into the
  // send flow would have read the keystore wallet's backup flag and used it to permit spending
  // the dev server's money: twelve words confirmed, sending unlocked, the words protecting
  // something else entirely. It was one line from shipping and it was an open assignment.
  const backedUp = { backedUpAt: 1762500000000 };
  const decision = spendAllowed(of(true, true), backedUp);
  assert.equal(decision.allowed, false, 'a backup of the OTHER wallet must not unlock this money');
  assert.equal(decision.allowed === false && decision.action, 'blocked');
});

test('where the phrase protects nothing, a permitted spend says so out loud', () => {
  // The dev server signs with its own seed; there is no phrase in the app to gate on. Allowing
  // the spend is right, and claiming it is protected is not — so the flag travels with the yes.
  for (const custody of [of(false, true), of(true, true, true)]) {
    const decision = spendAllowed(custody, { backedUpAt: 1762500000000 });
    assert.equal(decision.allowed, true);
    assert.equal(decision.allowed === true && decision.protectedByBackup, false,
      `${custody.kind} allowed a spend while implying a backup protects it`);
  }
});

test('with no wallet at all, sending asks for one', () => {
  const decision = spendAllowed(of(true, false), null);
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.action, 'create');
});

test('every allowed decision carries whether a backup protects it', () => {
  // Pins the shape: a caller cannot permit a spend without being handed the fact that nothing
  // is protecting it. A plain boolean return is what made the original mistake invisible.
  const cases: [Custody, { backedUpAt: number } | null][] = [
    [of(true, false), { backedUpAt: 1 }], [of(false, true), null],
    [of(false, false), null], [of(true, true, true), { backedUpAt: 1 }],
  ];
  for (const [custody, record] of cases) {
    const decision = spendAllowed(custody, record);
    if (decision.allowed) assert.equal(typeof decision.protectedByBackup, 'boolean', custody.kind);
  }
});
