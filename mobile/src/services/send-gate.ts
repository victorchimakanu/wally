/**
 * Whether this build is currently allowed to send.
 *
 * The backend can turn sending off for every installed copy. That exists because nothing else
 * can: a store release takes days of review, there are no over-the-air updates, and a build
 * that loses money would otherwise keep running on every phone until each user happened to
 * update. One flag is the difference between an apology and a loss.
 *
 * **It fails open.** Every failure here — no backend configured, network down, malformed
 * response, timeout — leaves sending enabled. Sending does not need the backend: the phone
 * signs and the chain accepts, so a backend outage must not take the wallet with it. The
 * threat is our own bug, not an adversarial user, and anyone who can block a request can also
 * just run an older build. Failing closed would trade a real outage for protection that does
 * not hold.
 *
 * That is a deliberate weakness and it is written here so nobody has to rediscover it.
 */

export type SendGate =
  | { allowed: true }
  | { allowed: false; reason: string; kind: 'disabled' | 'outdated' };

/** Compare dotted versions numerically: "1.10.0" is above "1.9.9", which a string compare gets wrong. */
export function versionBelow(current: string, minimum: string): boolean {
  if (!minimum.trim() || !current.trim()) return false;
  const parts = (v: string) => v.trim().split('.').map(n => Number.parseInt(n, 10));
  const a = parts(current), b = parts(minimum);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false; // unparseable: do not block
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** The shape /v1/status returns. Anything else is treated as no answer at all. */
function isStatus(value: unknown): value is { sendingEnabled: boolean; reason: string; minimumVersion: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.sendingEnabled === 'boolean' && typeof v.reason === 'string' && typeof v.minimumVersion === 'string';
}

/**
 * Decide from an already-fetched status body. Separated from the fetch so the decision is
 * testable on its own, which is the part that must never be wrong.
 */
export function gateFromStatus(body: unknown, appVersion: string): SendGate {
  if (!isStatus(body)) return { allowed: true };            // no usable answer: fail open
  if (!body.sendingEnabled) {
    return {
      allowed: false,
      kind: 'disabled',
      reason: body.reason.trim() || 'Sending is paused while something is being fixed. Your funds are untouched.',
    };
  }
  if (versionBelow(appVersion, body.minimumVersion)) {
    return {
      allowed: false,
      kind: 'outdated',
      reason: `This version of Wally can no longer send. Update to ${body.minimumVersion} or later. Your funds are untouched.`,
    };
  }
  return { allowed: true };
}

export type GateDeps = {
  origin: string;
  appVersion: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Ask the backend. Never throws, never blocks on its own failure. */
export async function checkSendGate({ origin, appVersion, headers = {}, fetch: doFetch = fetch, timeoutMs = 5000 }: GateDeps): Promise<SendGate> {
  if (!origin) return { allowed: true };                     // no backend configured
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(`${origin}/v1/status`, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) return { allowed: true };
    return gateFromStatus(await response.json(), appVersion);
  } catch {
    return { allowed: true };
  } finally {
    clearTimeout(timer);
  }
}
