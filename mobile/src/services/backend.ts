/**
 * The Wally backend proxy: one place that decides whether there is one and how to call it.
 *
 * Market data and chain history both route through it when configured, so the provider keys
 * stay on the server and every phone shares one cached, rate-limited origin.
 * See ../../../backend/README.md.
 *
 * Nothing here is required: with EXPO_PUBLIC_WALLY_PROXY_URL unset, each caller falls back to
 * the path it used before the backend existed.
 */
import { INSTALL_HEADER, currentInstallId } from './install-id.ts';

/**
 * Accept a proxy URL only when it is safe to call, and normalise it for path joining.
 * Returns '' for anything unparseable or unsafe, which every caller reads as "no proxy".
 */
export function resolveProxy(raw = process.env.EXPO_PUBLIC_WALLY_PROXY_URL ?? ''): string {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    // No credentials in the URL, and no path/query smuggling.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * Read from the environment on every call rather than memoising, so a module that re-reads
 * its configuration on import (see test/backend-proxy.test.ts) sees the current value.
 */
export function backendOrigin(): string {
  return resolveProxy();
}

/**
 * Shared key the backend may require, sent only to our own proxy and never to a third party.
 *
 * EXPO_PUBLIC_* values are compiled into the bundle, so this is not a secret from anyone
 * willing to unpack the app. It deters drive-by abuse of the backend's provider quota; it is
 * not user authentication.
 */
export function backendHeaders(origin = backendOrigin()): Record<string, string> {
  if (!origin) return {};
  const key = process.env.EXPO_PUBLIC_WALLY_APP_KEY ?? '';
  // The installation id, so the backend can tell this phone from the others sharing a
  // carrier address. Sent only to a configured Wally origin, and only alongside the key —
  // see `install-id.ts` for what it deliberately is not.
  const install = currentInstallId();
  return {
    ...(key ? { 'x-wally-key': key } : {}),
    ...(install ? { [INSTALL_HEADER]: install } : {}),
  };
}
