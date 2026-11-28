import test from 'node:test';
import assert from 'node:assert/strict';
import { gateFromStatus, versionBelow, checkSendGate } from '../src/services/send-gate.ts';

/**
 * This decides whether a build may move money. Every case is written around which way it
 * fails, because the two failure directions are not symmetric: wrongly allowing a send is a
 * bug we already knew about shipping, wrongly blocking one is an outage we caused ourselves.
 */

const OK = { sendingEnabled: true, reason: '', minimumVersion: '' };

test('an operator can stop every build from sending', () => {
  const gate = gateFromStatus({ ...OK, sendingEnabled: false, reason: 'A send bug is being fixed. Your funds are safe.' }, '1.0.0');
  assert.equal(gate.allowed, false);
  assert.equal(gate.allowed === false && gate.kind, 'disabled');
  assert.match(gate.allowed === false ? gate.reason : '', /funds are safe/);
});

test('a disabled status with no reason still says something useful', () => {
  const gate = gateFromStatus({ ...OK, sendingEnabled: false, reason: '   ' }, '1.0.0');
  assert.equal(gate.allowed, false);
  // Never show a blank screen in place of an explanation.
  assert.match(gate.allowed === false ? gate.reason : '', /paused|funds are untouched/i);
});

test('EVERY unusable answer fails open — this is the whole design', () => {
  for (const body of [
    null, undefined, 'a string', 42, [], {},
    { sendingEnabled: 'yes', reason: '', minimumVersion: '' },   // wrong type
    { sendingEnabled: true },                                     // missing fields
    { reason: 'x', minimumVersion: '1.0.0' },                     // missing the flag
  ]) {
    assert.equal(gateFromStatus(body, '1.0.0').allowed, true, `must allow on: ${JSON.stringify(body)}`);
  }
});

test('version comparison is numeric, not alphabetical', () => {
  assert.equal(versionBelow('1.9.9', '1.10.0'), true, '1.10.0 is newer than 1.9.9');
  assert.equal(versionBelow('1.10.0', '1.9.9'), false);
  assert.equal(versionBelow('1.0.0', '1.0.0'), false, 'equal is not below');
  assert.equal(versionBelow('2.0', '1.9.9'), false);
  assert.equal(versionBelow('1.0', '1.0.1'), true, 'missing parts count as zero');
});

test('an unparseable or absent version never blocks anyone', () => {
  assert.equal(versionBelow('', '1.0.0'), false);
  assert.equal(versionBelow('1.0.0', ''), false, 'an empty minimum disables the check');
  assert.equal(versionBelow('not-a-version', '1.0.0'), false);
  assert.equal(versionBelow('1.0.0', 'latest'), false);
  // And through the gate, which is what actually matters.
  assert.equal(gateFromStatus({ ...OK, minimumVersion: 'latest' }, '1.0.0').allowed, true);
});

test('an outdated build is told what to do, not just refused', () => {
  const gate = gateFromStatus({ ...OK, minimumVersion: '2.0.0' }, '1.4.0');
  assert.equal(gate.allowed, false);
  assert.equal(gate.allowed === false && gate.kind, 'outdated');
  const reason = gate.allowed === false ? gate.reason : '';
  assert.match(reason, /2\.0\.0/, 'must name the version to update to');
  assert.match(reason, /funds are untouched/i);
});

test('being disabled outranks being outdated, so the operator message is the one shown', () => {
  const gate = gateFromStatus({ sendingEnabled: false, reason: 'Paused for a fix.', minimumVersion: '9.9.9' }, '1.0.0');
  assert.equal(gate.allowed === false && gate.kind, 'disabled');
});

test('no backend configured means no gate', async () => {
  assert.deepEqual(await checkSendGate({ origin: '', appVersion: '1.0.0' }), { allowed: true });
});

test('a network failure, a timeout and an error status all leave sending enabled', async () => {
  const thrown = await checkSendGate({ origin: 'http://x', appVersion: '1.0.0', fetch: async () => { throw new Error('offline'); } });
  assert.equal(thrown.allowed, true);

  const serverError = await checkSendGate({ origin: 'http://x', appVersion: '1.0.0', fetch: async () => new Response('nope', { status: 500 }) });
  assert.equal(serverError.allowed, true);

  const badJson = await checkSendGate({ origin: 'http://x', appVersion: '1.0.0', fetch: async () => new Response('<html>', { status: 200 }) });
  assert.equal(badJson.allowed, true, 'an HTML error page must not block sending');
});

test('a genuine disable does come through the fetch path', async () => {
  const gate = await checkSendGate({
    origin: 'http://x', appVersion: '1.0.0',
    fetch: async () => new Response(JSON.stringify({ sendingEnabled: false, reason: 'Paused.', minimumVersion: '' }), { status: 200 }),
  });
  assert.equal(gate.allowed, false);
});
