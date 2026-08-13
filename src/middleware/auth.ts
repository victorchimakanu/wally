// Signed session cookies. SESSION_SECRET (required config) HMAC-signs the
// session ID; the browser holds it as an HttpOnly cookie it cannot read or
// forge, and every HTTP and WebSocket entry point verifies the signature
// before touching a session. No unsigned or client-invented ID is accepted.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const COOKIE_NAME = "wally_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
}

// safeEqual is a constant-time string compare that NEVER throws. timingSafeEqual
// throws on unequal BYTE length, and a character-length precheck is not enough
// (a multibyte char makes a 64-char string exceed 64 bytes). An attacker could
// craft such a value to trigger the throw; in the raw WebSocket upgrade handler
// that would become an uncaughtException and take the process down. Comparing
// Buffer byte lengths first closes that.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function makeSessionCookie(id: string): string {
  // The signed payload includes an issued-at timestamp, so a captured raw
  // cookie stops verifying after MAX_AGE — it is not a permanent credential.
  const iat = Date.now();
  const payload = `${id}.${iat}`;
  const secure = config.allowRemote ? " Secure;" : "";
  return `${COOKIE_NAME}=${payload}.${sign(payload)};${secure} HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
}

// verifySessionCookie returns the session ID when the cookie carries a validly
// signed, non-expired value, and null otherwise.
export function verifySessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    // Format: <id>.<iat>.<hmac(id.iat)>
    const lastDot = value.lastIndexOf(".");
    if (lastDot <= 0) return null;
    const payload = value.slice(0, lastDot);
    const mac = value.slice(lastDot + 1);
    const expected = sign(payload);
    if (!safeEqual(mac, expected)) return null;
    const midDot = payload.lastIndexOf(".");
    if (midDot <= 0) return null;
    const id = payload.slice(0, midDot);
    const iat = Number(payload.slice(midDot + 1));
    if (!Number.isFinite(iat) || Date.now() - iat > MAX_AGE_MS) return null;
    return id;
  }
  return null;
}

// checkAccessToken gates cookie issuance when the server is exposed
// off-loopback. On loopback (accessToken unset) it always passes. Otherwise
// the caller must present the shared secret in the `x-wally-access` header,
// checked in constant time. Deliberately NOT accepted as a query parameter,
// which would leak the secret via browser history, Referer, and access logs.
export function checkAccessToken(headerValue: string | undefined): boolean {
  const expected = config.accessToken;
  if (!expected) return true; // loopback default: no token required
  if (!headerValue) return false;
  return safeEqual(headerValue, expected);
}

// isAllowedOrigin: browsers send an Origin header; only this app's own
// loopback origin may open a WebSocket or call the API. Requests without an
// Origin header (curl, scripts) still need the signed cookie to do anything.
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const u = new URL(origin);
    const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
    const port = u.port === "" ? (u.protocol === "https:" ? "443" : "80") : u.port;
    return loopback && port === String(config.port);
  } catch {
    return false;
  }
}
