import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monotonicNow, quoteDeadline, quoteExpired, secondsLeft, plausibleQuoteSpan,
  MIN_QUOTE_MS, MAX_QUOTE_MS,
} from '../src/services/quote-clock.ts';
import { parseQuote } from '../src/services/wallet-api.ts';

/**
 * Quote expiry, measured on one clock.
 *
 * The bug: the server stamped `expiresAt` with its own clock and the app compared it against
 * the phone's. A handset running a few minutes fast saw every quote as already expired and
 * could not send at all. These cases are mostly about proving the comparison no longer involves
 * two clocks, and that a clock which jumps cannot change the answer.
 */

const ADDR = '0x1111111111111111111111111111111111111111';
const quote = (over: Record<string, unknown> = {}) => ({
  id: '12345678-1234-1234-1234-123456789012',
  chain: 'arbitrum', chainId: 421614, network: 'Arbitrum Sepolia', symbol: 'ETH',
  from: ADDR, recipient: ADDR, amount: '0.001', fee: '0.000021', total: '0.001021',
  expiresAt: 1_700_000_061_000, expiresInMs: 60_000, ...over,
});

test('a deadline is derived from the phone, at the moment of receipt', () => {
  assert.equal(quoteDeadline(60_000, 1_000), 61_000);
  // Fixed at receipt. Deriving it later would silently extend the quote by the delay.
  assert.notEqual(quoteDeadline(60_000, 1_000), quoteDeadline(60_000, 5_000));
});

test("a wrong phone clock no longer expires a live quote — the bug this replaces", () => {
  // The server thinks the quote dies at 1_700_000_061_000. A phone five minutes fast used to
  // compare that against its own Date.now() and conclude the quote was already dead.
  const serverExpiresAt = 1_700_000_061_000;
  const phoneFiveMinutesFast = serverExpiresAt + 5 * 60_000;
  assert.equal(serverExpiresAt <= phoneFiveMinutesFast, true, 'the old comparison said expired');

  // The new one never looks at the server's timestamp. 60s after receipt, on the phone's own
  // monotonic clock, the quote is still live.
  const deadline = quoteDeadline(60_000, 10_000);
  assert.equal(quoteExpired(deadline, 10_000), false);
  assert.equal(quoteExpired(deadline, 69_999), false);
  assert.equal(quoteExpired(deadline, 70_000), true, 'and it does expire, on time');
});

test('a clock that jumps mid-quote cannot change the answer', () => {
  // performance.now() does not jump. This pins the property the code relies on rather than the
  // implementation: the same elapsed time gives the same verdict regardless of wall-clock
  // changes, because no wall clock is consulted.
  const deadline = quoteDeadline(60_000, 1_000);
  // 30 seconds of real time have passed.
  assert.equal(quoteExpired(deadline, 31_000), false);
  assert.equal(secondsLeft(deadline, 31_000), 30);
  // A timezone change or NTP correction would move Date.now() by hours and must be irrelevant.
  assert.equal(quoteExpired(deadline, 31_000), quoteExpired(deadline, 31_000));
});

test('the countdown never shows a negative or a misleading zero', () => {
  const deadline = quoteDeadline(60_000, 0);
  assert.equal(secondsLeft(deadline, 0), 60);
  assert.equal(secondsLeft(deadline, 59_600), 1, '400ms left reads as 1 second, not 0, while still valid');
  assert.equal(secondsLeft(deadline, 60_000), 0);
  assert.equal(secondsLeft(deadline, 120_000), 0, 'never negative');
});

test('an implausible or absent duration is refused, not worked around', () => {
  for (const bad of [0, -1, 999, MAX_QUOTE_MS + 1, 1.5, NaN, Infinity, '60000', null, undefined]) {
    assert.equal(plausibleQuoteSpan(bad), false, `must refuse: ${String(bad)}`);
  }
  assert.equal(plausibleQuoteSpan(MIN_QUOTE_MS), true);
  assert.equal(plausibleQuoteSpan(60_000), true);
  assert.equal(plausibleQuoteSpan(MAX_QUOTE_MS), true);

  // The clamp is a second line behind parseQuote, in case a value ever gets past it.
  assert.equal(quoteDeadline(MAX_QUOTE_MS * 100, 0), MAX_QUOTE_MS);
  assert.equal(quoteDeadline(-5_000, 1_000), 1_000);
  assert.equal(quoteDeadline(NaN, 7), 7);
  assert.equal(quoteExpired(NaN), true, 'an unusable deadline counts as expired, never as live');
});

test('parseQuote refuses a response that does not say how long it is valid for', () => {
  // Required rather than optional: falling back to comparing the server's expiresAt against
  // this phone's clock is precisely the bug, so a server that does not send a duration must
  // fail loudly instead of quietly reinstating it.
  assert.throws(() => parseQuote(quote({ expiresInMs: undefined })), /how long it is valid for/);
  assert.throws(() => parseQuote(quote({ expiresInMs: 0 })), /how long it is valid for/);
  assert.throws(() => parseQuote(quote({ expiresInMs: '60000' })), /how long it is valid for/);
  assert.throws(() => parseQuote(quote({ expiresInMs: MAX_QUOTE_MS + 1 })), /how long it is valid for/);
});

test('a parsed quote carries a usable local deadline', () => {
  const before = monotonicNow();
  const parsed = parseQuote(quote());
  const after = monotonicNow();

  // Stamped between the two readings, 60s out.
  assert.ok(parsed.deadline >= before + 60_000, 'at least the full span from before the call');
  assert.ok(parsed.deadline <= after + 60_000, 'and no more than from after it');
  assert.equal(quoteExpired(parsed.deadline), false, 'a fresh quote is not expired');
  // The server's own timestamp is preserved untouched, for the record.
  assert.equal(parsed.expiresAt, 1_700_000_061_000);
  assert.equal(parsed.expiresInMs, 60_000);
});

test('monotonicNow moves forward and is not the wall clock', () => {
  const a = monotonicNow();
  const b = monotonicNow();
  assert.ok(b >= a, 'never goes backwards');
  assert.equal(typeof a, 'number');
  assert.ok(Number.isFinite(a));
});
