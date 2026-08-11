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
