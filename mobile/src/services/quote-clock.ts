/**
 * When a fee quote expires, measured on one clock instead of two.
 *
 * **The bug this replaces.** The wallet server stamped a quote with `this.now() + 60000` — its
 * clock — and the app compared that stamp against `Date.now()` — the phone's. Two independent
 * clocks, no agreement required between them. A phone running a few minutes fast saw every
 * quote as already expired and **could not send at all**; one running slow showed a countdown
 * that lied and then got the submission refused. Phones with wrong clocks are ordinary.
 * FEATURE-AUDIT §28.2.
 *
 * **The fix is a duration, not a timestamp.** The server says how long the quote is good for;
 * the phone decides when that is up, using only its own clock. Neither side needs to know what
 * time the other thinks it is.
 *
 * **And the phone's clock is the monotonic one, not the wall clock.** `Date.now()` jumps when a
 * timezone changes, when NTP corrects, or when someone sets the date by hand — any of which
 * mid-quote would expire a live quote or revive a dead one. `performance.now()` only ever moves
 * forward at one second per second, which is the only property this needs.
 *
 * The server still enforces expiry with its own clock, and that remains the real boundary: this
 * is what the *user* is shown and what stops a pointless submission. Making the client
 * authoritative would let a phone with a rigged clock spend an expired quote.
 */

/** How long a quote may be good for. A server answer outside this is not believed. */
export const MIN_QUOTE_MS = 1_000;
export const MAX_QUOTE_MS = 10 * 60_000;

/**
 * A clock that cannot jump.
 *
 * React Native and every browser provide `performance.now()`. The fallback exists because a
 * missing one would otherwise throw at module load, and a wall clock is still better than no
 * clock — the behaviour then degrades to the old bug rather than to a crash.
 */
export function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

/**
 * The local deadline for a quote, fixed at the moment the quote arrived.
 *
 * Call this once, on receipt. Calling it later would silently extend the quote by however long
 * the delay was.
 */
export function quoteDeadline(expiresInMs: number, now = monotonicNow()): number {
  if (!Number.isFinite(expiresInMs)) return now;
  // Clamped rather than trusted. A server answer of 0 makes every quote dead on arrival and a
  // huge one makes a stale quote look live; both are refused by parseQuote, and this is the
  // second line in case one ever is not.
  const span = Math.min(Math.max(expiresInMs, 0), MAX_QUOTE_MS);
  return now + span;
}

export function quoteExpired(deadline: number, now = monotonicNow()): boolean {
  return !Number.isFinite(deadline) || deadline <= now;
}

/**
 * Whole seconds left, for the countdown. Never negative, and rounded up so a quote with 400ms
 * left reads "1 second" rather than "0 seconds" while still being valid.
 */
export function secondsLeft(deadline: number, now = monotonicNow()): number {
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** True when a server-declared duration is one we are willing to act on. */
export function plausibleQuoteSpan(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_QUOTE_MS && value <= MAX_QUOTE_MS;
}
