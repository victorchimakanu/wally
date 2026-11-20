/**
 * Who a request is from, for the purpose of refusing too many of them.
 *
 * ## The problem this exists for
 *
 * Until now the only answer was the client IP, and that is the wrong answer for the people
 * Wally is built for. **Carrier-grade NAT is the norm on Nigerian mobile networks**: many
 * subscribers share one public address, so a per-address budget is divided among strangers.
 * At 120 requests a minute, somewhere around two dozen active users behind one address
 * exhaust it and the rest get 429s for doing nothing wrong. There is no error message that
 * makes that acceptable, and no amount of retrying fixes it.
 *
 * ## What an installation id is, and what it is emphatically not
 *
 * The app generates a random identifier on first run and sends it with every request. Two
 * phones behind one carrier address are then two budgets instead of half a budget each.
 *
 * **It is not authentication and it is not a defence.** A client chooses what to send, so an
 * attacker sends a fresh one per request and has as many budgets as it likes. Anyone reading
 * this as a security control has read it wrong.
 *
 * So the address limit does not go away — it becomes a ceiling rather than the whole policy.
 * Honest clients are separated from each other by their id; a dishonest one is still bounded
 * by the address it is coming from. Two limits, and a request has to pass both:
 *
 * - **Per installation**, the budget one user should get.
 * - **Per address**, generous enough that a shared carrier address holds many real users, and
 *   low enough to bound one machine.
 *
 * A request with no id, or one that does not look like an id, is budgeted **per address at the
 * installation rate** — exactly the behaviour that existed before. It is not a free pass, and
 * it keeps curl, health checks and any older build working without a special case.
 *
 * ## Why the paymaster gets its own, tighter limit
 *
 * Raising the address ceiling to fit a carrier's worth of users widens what a single address
 * can ask the sponsorship budget to pay for, by exactly the factor the ceiling went up. A
 * sponsorship policy is money. So the route that spends it is limited separately and far more
 * tightly, because nobody legitimately needs many sponsored operations a minute. Without that,
 * this change would make the money exposure worse while making the error rate better.
 *
 * ## Privacy
 *
 * This service holds no keys, no seeds and no personal data, and its logs carry `{chain,
 * method}` and status codes but never an address. An installation id is the first identifier
 * it has ever been given, so: it is random rather than derived from the device, it is never
 * logged, it is never stored beyond the in-memory window it is counted in, and the app clears
 * it when someone deletes their data. It answers "is this the same caller as a moment ago" and
 * nothing else.
 */

/** The shape an installation id must have to be counted as one. */
const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INSTALL_HEADER = "x-wally-install";

/**
 * Read a usable installation id out of a header value, or null.
 *
 * Strict on purpose. A header is attacker-controlled, and this value becomes a key in a map
 * that lives for a minute — so anything that is not exactly a UUID is refused rather than
 * trimmed into shape, and an array (a repeated header) is refused rather than joined. The
 * fallback is not a failure: an unreadable id is budgeted per address, which is where everyone
 * was before.
 */
export function readInstallId(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return INSTALL_ID.test(value) ? value.toLowerCase() : null;
}

/** Fixed-window counter. In-memory is adequate for a single VPS process. */
export function createRateLimiter(perMinute: number, now: () => number = Date.now) {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return function allow(key: string): boolean {
    const at = now();
    // Opportunistic sweep; this map only grows with distinct active callers. Bounded below as
    // well, because an attacker rotating ids is exactly how it would otherwise grow forever.
    if (windows.size > 10_000) {
      for (const [id, w] of windows) if (w.resetAt <= at) windows.delete(id);
      // Still full of live windows: refuse to ADMIT a new key, rather than become a memory
      // leak someone else controls.
      //
      // `!windows.has(key)` is load-bearing. Refusing unconditionally here would let anyone
      // rotate ten thousand identifiers and have the service then refuse every real caller
      // too — a denial of service triggered by the very defence meant to prevent one. So a
      // caller already inside keeps its budget, and only growth is turned away; the address
      // ceiling is what bounds the one doing the rotating.
      if (windows.size > 10_000 && !windows.has(key)) return false;
    }
    const window = windows.get(key);
    if (!window || window.resetAt <= at) {
      windows.set(key, { count: 1, resetAt: at + 60_000 });
      return true;
    }
    window.count++;
    return window.count <= perMinute;
  };
}

export type Caller = {
  /** The key this request is budgeted under. */
  key: string;
  /** Whether it identified itself, for choosing which budget applies. */
  identified: boolean;
};

/**
 * How this request will be counted.
 *
 * The `install:` and `ip:` prefixes keep the two namespaces apart, so a client cannot send an
 * id that collides with an address and spend someone else's budget.
 */
export function callerOf(request: { ip: string; headers: Record<string, string | string[] | undefined> }): Caller {
  const install = readInstallId(request.headers[INSTALL_HEADER]);
  return install ? { key: `install:${install}`, identified: true } : { key: `ip:${request.ip}`, identified: false };
}
