import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubCrash, toRecord, addRecord, parseRecords, reportText, MAX_RECORDS, MAX_STACK } from '../src/services/crash-log.ts';

/**
 * A crash is the moment key material is most likely to be sitting in a variable that ends up in
 * a stack trace. This file is the control that stops it being written down, so these tests are
 * adversarial rather than illustrative: each one is a way a seed could escape.
 */

const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const KEY = '0x' + 'a1b2c3d4'.repeat(8);                       // 64 hex
const ADDRESS = '0xb4B0075A05cd88c668121b4e46a3B094847BfC29';   // 40 hex

test('a recovery phrase never survives, wherever it appears', () => {
  for (const text of [
    PHRASE,
    `Error: could not restore ${PHRASE}`,
    `{"mnemonic":"${PHRASE}"}`,
    `at restore (${PHRASE})`,
  ]) {
    const out = scrubCrash(text);
    assert.ok(!out.includes('sausage'), `phrase survived in: ${text.slice(0, 40)}`);
    assert.ok(!out.includes('useful'), 'a word of the phrase survived');
  }
  // A 24-word phrase too.
  const long = Array.from({ length: 24 }, (_, i) => ['abandon', 'ability', 'able', 'about'][i % 4]).join(' ');
  assert.ok(!scrubCrash(long).includes('abandon'));
});

test('64 hex characters go entirely, key or hash', () => {
  // A transaction hash would be useful in a report and a private key would be catastrophic,
  // and from here they are indistinguishable. Both go.
  assert.ok(!scrubCrash(`key=${KEY}`).includes('a1b2c3d4'));
  assert.ok(!scrubCrash(KEY.slice(2)).includes('a1b2c3d4'), 'with no 0x prefix either');
  assert.ok(!scrubCrash(`tx ${'f'.repeat(64)} failed`).includes('f'.repeat(64)));
});

test('an address is truncated, not removed — a report has to say which wallet', () => {
  const out = scrubCrash(`balance for ${ADDRESS} failed`);
  assert.ok(!out.includes(ADDRESS), 'the full address must not survive');
  assert.match(out, /0xb4B007…fC29/);
});

test('a 64-hex key is never half-caught by the address rule', () => {
  // The ordering bug this guards: match 40 of 64 characters first and 24 are left in the clear.
  const out = scrubCrash(KEY);
  assert.ok(!/[\da-fA-F]{20,}/.test(out), `hex survived: ${out}`);
});

test('the encrypted seed blob does not survive', () => {
  const ciphertext = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5YWJjZGVmZ2hpamtsbW5vcA==';
  assert.ok(!scrubCrash(`record=${ciphertext}`).includes('YWJjZGVm'));
});

test('a labelled secret goes whatever shape it has', () => {
  for (const label of ['seed', 'mnemonic', 'phrase', 'privateKey', 'private_key', 'secret', 'password', 'entropy']) {
    const out = scrubCrash(`${label}=hunter2correcthorse`);
    assert.ok(!out.includes('hunter2'), `${label} leaked`);
    assert.ok(out.toLowerCase().includes(label.toLowerCase()), 'the label itself is useful context');
  }
});

test('ordinary messages are left readable', () => {
  const message = 'Not enough testnet ETH. Fund this address from a faucet before sending.';
  assert.equal(scrubCrash(message), message);
  assert.equal(scrubCrash('TypeError: undefined is not a function'), 'TypeError: undefined is not a function');
});

test('scrubbing never throws, whatever it is handed', () => {
  for (const odd of [null, undefined, 0, {}, [], Symbol('x').toString(), NaN]) {
    assert.equal(typeof scrubCrash(odd), 'string');
  }
});

// ── Records ───────────────────────────────────────────────────────────────────────────────────

test('a record is scrubbed before it is stored, not before it is shown', () => {
  const error = new Error(`restore failed for ${PHRASE}`);
  error.stack = `Error: ${PHRASE}\n    at restore (${KEY})`;
  const record = toRecord('error', error, 'Wally 1.0.0 (development)', 1762500000000);
  assert.ok(!record.message.includes('sausage'));
  assert.ok(!record.stack.includes('sausage'));
  assert.ok(!record.stack.includes('a1b2c3d4'));
  assert.equal(record.kind, 'error');
  assert.equal(record.at, 1762500000000);
});

test('a thrown non-Error still produces a record', () => {
  // Code throws strings, and a crash handler that crashes is worthless.
  for (const thrown of ['boom', 42, null, undefined, { why: 'no' }]) {
    const record = toRecord('rejection', thrown, 'b', 1);
    assert.equal(typeof record.message, 'string');
    assert.ok(record.message.length > 0);
  }
});

test('the log is capped, newest first', () => {
  let log = [] as ReturnType<typeof toRecord>[];
  for (let i = 0; i < MAX_RECORDS + 5; i++) log = addRecord(log, toRecord('error', new Error(`e${i}`), 'b', i + 1));
  assert.equal(log.length, MAX_RECORDS);
  assert.match(log[0]!.message, new RegExp(`e${MAX_RECORDS + 4}$`), 'newest first');
});

test('a huge stack is clipped rather than stored whole', () => {
  const error = new Error('big');
  error.stack = 'x'.repeat(MAX_STACK * 3);
  assert.ok(toRecord('error', error, 'b', 1).stack.length <= MAX_STACK);
});

test('a corrupt log reads as empty instead of crashing the crash reporter', () => {
  assert.deepEqual(parseRecords(null), []);
  assert.deepEqual(parseRecords('nonsense'), []);
  assert.deepEqual(parseRecords([{ at: 'soon' }, null, 42]), []);
  const good = toRecord('error', new Error('ok'), 'b', 5);
  assert.deepEqual(parseRecords([good, { broken: true }]), [good]);
});

test('the text handed over is scrubbed again on the way out', () => {
  // The stored copy is already clean. This is the string that actually leaves the device.
  const smuggled = { at: 1, kind: 'error' as const, message: PHRASE, stack: KEY, build: 'b' };
  const text = reportText([smuggled]);
  assert.ok(!text.includes('sausage'));
  assert.ok(!text.includes('a1b2c3d4'));
});

test('an empty log says so plainly', () => {
  assert.match(reportText([]), /No problems have been recorded/);
});
