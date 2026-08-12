// Signed session cookies. SESSION_SECRET (required config) HMAC-signs the
// session ID; the browser holds it as an HttpOnly cookie it cannot read or
// forge, and every HTTP and WebSocket entry point verifies the signature
// before touching a session. No unsigned or client-invented ID is accepted.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const COOKIE_NAME = "wally_session";

function sign(id: string): string {
  return createHmac("sha256", config.sessionSecret).update(id).digest("hex");
}

export function makeSessionCookie(id: string): string {
  return `${COOKIE_NAME}=${id}.${sign(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
}

// verifySessionCookie returns the session ID when the cookie header carries a
// validly signed value, and null otherwise.
export function verifySessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const id = value.slice(0, dot);
    const mac = value.slice(dot + 1);
    const expected = sign(id);
    if (mac.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    return id;
  }
  return null;
}

// checkAccessToken gates cookie issuance when the server is exposed
// off-loopback. On loopback (accessToken unset) it always passes. Otherwise
// the caller must present the shared secret, checked in constant time, via
// the `access_token` query parameter or the `x-wally-access` header.
export function checkAccessToken(query: unknown, headerValue: string | undefined): boolean {
  const expected = config.accessToken;
  if (!expected) return true; // loopback default: no token required
  const provided =
    (query && typeof query === "object" && typeof (query as Record<string, unknown>)["access_token"] === "string"
      ? ((query as Record<string, string>)["access_token"])
      : undefined) ?? headerValue;
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
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
