/**
 * Asking the backend to watch a submitted transfer, so a sleeping phone does not have to.
 *
 * `/v1/watch/:chain/:hash` has existed since PR #44 and nothing has ever called it. The route
 * polls the chain for a receipt and keeps the answer for half an hour; the phone's own check
 * goes to the loopback wallet server, which asks a public Sepolia node and took 11 to 12
 * seconds a call when that was measured on 8 November 2026. So the watcher is worth reading
 * for one reason: it usually already knows.
 *
 * ## What this is not allowed to do
 *
 * **A watcher that cannot answer must never look like a failed transfer.** Not watched, not
 * reachable, not configured, a shape that does not parse — every one of those is "no opinion",
 * and the caller falls through to the authoritative check. The backend takes the same care at
 * its own end: a null receipt is pending, because a transaction accepted and not yet in a
 * block has not failed. Telling someone their money did not move when it is about to is the
 * worst thing either side of this could do.
 *
 * So this module reports a state only when the backend affirmatively says so, and every
 * failure path here returns `null` rather than throwing. Registering a watch is advisory and
 * its result is ignored entirely.
 */
import { backendHeaders, backendOrigin } from './backend.ts';
import type { Chain } from './wallet-api.ts';

/** The backend's `WatchState`. `expired` means it gave up, which is not a verdict either. */
export type WatchState = 'pending' | 'confirmed' | 'failed' | 'expired';

export type TransferWatch = {
  chain: Chain;
  hash: string;
  state: WatchState;
  since: number;
  /** When the chain was last asked. 0 means never. */
  checkedAt: number;
  blockNumber?: number;
};

const HASH = /^0x[\da-f]{64}$/i;
const STATES: readonly string[] = ['pending', 'confirmed', 'failed', 'expired'];

/**
 * Read a watch, or refuse it.
 *
 * Returns null rather than throwing, because every caller treats an unreadable answer the same
 * way as no answer: ignore it and ask the authoritative source.
 */
export function parseWatch(value: unknown, expect?: { chain: Chain; hash: string }): TransferWatch | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data['chain'] !== 'string' || typeof data['hash'] !== 'string') return null;
  if (!HASH.test(data['hash'])) return null;
  if (typeof data['state'] !== 'string' || !STATES.includes(data['state'])) return null;
  if (typeof data['since'] !== 'number' || !Number.isFinite(data['since'])) return null;
  if (typeof data['checkedAt'] !== 'number' || !Number.isFinite(data['checkedAt'])) return null;
  const block = data['blockNumber'];
  if (block !== undefined && (typeof block !== 'number' || !Number.isInteger(block) || block < 0)) return null;
  // An answer about a different transfer is not an answer about this one. Without this a
  // mismatched reply would be read as the state of the hash on screen.
  if (expect && (data['chain'] !== expect.chain || data['hash'].toLowerCase() !== expect.hash.toLowerCase())) return null;
  return {
    chain: data['chain'] as Chain,
    hash: data['hash'],
    state: data['state'] as WatchState,
    since: data['since'],
    checkedAt: data['checkedAt'],
    ...(block === undefined ? {} : { blockNumber: block as number }),
  };
}

/** Settled as far as the backend is concerned. `expired` is settled: it will not check again. */
export function watchSettled(watch: TransferWatch | null): boolean {
  return watch?.state === 'confirmed' || watch?.state === 'failed' || watch?.state === 'expired';
}

/**
 * What a watch says about the transfer, if anything.
 *
 * `expired` maps to nothing deliberately: the backend stopped looking, which says something
 * about the backend and nothing about the transfer. Only a receipt it actually read becomes a
 * status the app will show.
 */
export function watchStatus(watch: TransferWatch | null): 'pending' | 'confirmed' | 'failed' | null {
  if (!watch) return null;
  return watch.state === 'expired' ? null : watch.state;
}

async function call(path: string, method: 'GET' | 'POST', transport: typeof fetch, timeoutMs: number): Promise<unknown> {
  const origin = backendOrigin();
  if (!origin) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await transport(`${origin}${path}`, {
      method,
      headers: { Accept: 'application/json', ...backendHeaders(origin) },
      signal: controller.signal,
    });
    // 404 is the route's honest "not watched". Every other non-OK is equally not an opinion.
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the backend to start watching a hash.
 *
 * Advisory and fire-and-forget: the transfer is already submitted and on the chain by the time
 * this is called, so nothing about it depends on the request succeeding. Deliberately never
 * throws — a backend that is down must not turn a successful send into an error on screen.
 *
 * Short timeout for the same reason. The route asks the chain once before answering, which is
 * useful when somebody is waiting for the reply and pure latency when nobody is.
 */
export async function watchTransfer(chain: Chain, hash: string, transport: typeof fetch = fetch): Promise<TransferWatch | null> {
  if (!HASH.test(hash)) return null;
  return parseWatch(await call(`/v1/watch/${chain}/${hash}`, 'POST', transport, 8000), { chain, hash });
}

/** What the backend currently knows, or null if it does not know anything. */
export async function readWatch(chain: Chain, hash: string, transport: typeof fetch = fetch): Promise<TransferWatch | null> {
  if (!HASH.test(hash)) return null;
  return parseWatch(await call(`/v1/watch/${chain}/${hash}`, 'GET', transport, 8000), { chain, hash });
}
