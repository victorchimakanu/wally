import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  parseWatch, watchSettled, watchStatus, type TransferWatch,
} from '../src/services/transfer-watch.ts';
import type { Chain } from '../src/services/wallet-api.ts';

/**
 * The backend watches a submitted transfer so a sleeping phone does not have to. The rule
 * these cases exist to hold is one-directional: **a watcher that cannot answer must never
 * look like a failed transfer.** Not watched, not reachable, not configured, a shape that
 * does not parse — all of those are "no opinion", and the caller falls back to asking the
 * chain properly. Telling someone their money did not move when it is about to is the worst
 * thing this code could do.
 */

const HASH = '0x' + 'a'.repeat(64);
const OTHER = '0x' + 'b'.repeat(64);

function watch(over: Partial<TransferWatch> = {}): Record<string, unknown> {
  return { chain: 'arbitrum', hash: HASH, state: 'pending', since: 1_700_000_000_000, checkedAt: 0, ...over };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────────────────────

test('a well-formed watch is read', () => {
  const parsed = parseWatch(watch({ state: 'confirmed', blockNumber: 12 }));
  assert.equal(parsed?.state, 'confirmed');
  assert.equal(parsed?.blockNumber, 12);
});

test('an answer about a different transfer is not an answer about this one', () => {
  // Without this check a mismatched reply would be read as the state of the hash on screen.
  assert.equal(parseWatch(watch({ hash: OTHER }), { chain: 'arbitrum', hash: HASH }), null);
  assert.equal(parseWatch(watch({ chain: 'ethereum' as Chain }), { chain: 'arbitrum', hash: HASH }), null);
  assert.ok(parseWatch(watch(), { chain: 'arbitrum', hash: HASH }));
});

test('hash case does not make a matching answer look like a mismatched one', () => {
  assert.ok(parseWatch(watch({ hash: HASH.toUpperCase().replace('0X', '0x') }), { chain: 'arbitrum', hash: HASH }));
});

test('every malformed shape is refused rather than half-read', () => {
  for (const bad of [
    null, undefined, 'pending', 42, [],
    watch({ state: 'settled' as never }),
    watch({ state: '' as never }),
    { ...watch(), hash: '0xnope' },
    { ...watch(), since: 'soon' },
    { ...watch(), checkedAt: null },
    { ...watch(), blockNumber: -1 },
    { ...watch(), blockNumber: 1.5 },
    { ...watch(), blockNumber: '0x5' },
    { ...watch(), chain: 12 },
  ]) assert.equal(parseWatch(bad as unknown), null, `accepted ${JSON.stringify(bad)}`);
});

// ─── Reading a state out of a watch ──────────────────────────────────────────────────────────

test('no watch is no opinion, never a verdict', () => {
  assert.equal(watchStatus(null), null);
  assert.equal(watchSettled(null), false);
});

test('expired says something about the backend and nothing about the transfer', () => {
  // The backend stopped looking. Reporting that as a status would put a verdict on screen
  // that nothing on the chain supports.
  const expired = parseWatch(watch({ state: 'expired' }));
  assert.equal(watchStatus(expired), null);
  // Settled all the same: it will not be checked again, so there is nothing to wait for.
  assert.equal(watchSettled(expired), true);
});

test('only a receipt the backend actually read becomes a status', () => {
  assert.equal(watchStatus(parseWatch(watch({ state: 'pending' }))), 'pending');
  assert.equal(watchStatus(parseWatch(watch({ state: 'confirmed' }))), 'confirmed');
  assert.equal(watchStatus(parseWatch(watch({ state: 'failed' }))), 'failed');
});

test('pending is not settled, so the screen keeps asking', () => {
  assert.equal(watchSettled(parseWatch(watch({ state: 'pending' }))), false);
  assert.equal(watchSettled(parseWatch(watch({ state: 'confirmed' }))), true);
  assert.equal(watchSettled(parseWatch(watch({ state: 'failed' }))), true);
});

// ─── Over the wire ───────────────────────────────────────────────────────────────────────────

async function withServer(
  handler: (url: string, body: string) => { code: number; body: unknown },
  run: (mod: typeof import('../src/services/transfer-watch.ts'), seen: string[]) => Promise<void>,
): Promise<void> {
  const seen: string[] = [];
  const server: Server = createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    const answer = handler(request.url ?? '', '');
    response.writeHead(answer.code, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  process.env['EXPO_PUBLIC_WALLY_PROXY_URL'] = `http://127.0.0.1:${port}`;
  try {
    // Held in a variable: tsc tries to resolve a literal specifier as a real file path.
    const specifier = `../src/services/transfer-watch.ts?case=${port}`;
    await run(await import(specifier), seen);
  } finally {
    delete process.env['EXPO_PUBLIC_WALLY_PROXY_URL'];
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test('watching a transfer posts the hash and reads the answer back', async () => {
  await withServer(() => ({ code: 200, body: watch({ state: 'confirmed', blockNumber: 9 }) }), async (mod, seen) => {
    const result = await mod.watchTransfer('arbitrum', HASH);
    assert.deepEqual(seen, [`POST /v1/watch/arbitrum/${HASH}`]);
    assert.equal(result?.state, 'confirmed');
  });
});

test('a transfer nobody is watching reads as no opinion, not as failure', async () => {
  // The route answers 404 with {watching:false}. That is its honest "ask the chain yourself".
  await withServer(() => ({ code: 404, body: { error: 'That transfer is not being watched.', watching: false } }), async mod => {
    assert.equal(await mod.readWatch('arbitrum', HASH), null);
  });
});

test('a backend that errors reads as no opinion, not as failure', async () => {
  for (const code of [400, 429, 500, 503]) {
    await withServer(() => ({ code, body: { error: 'nope' } }), async mod => {
      assert.equal(await mod.readWatch('arbitrum', HASH), null, `status ${code} produced a verdict`);
    });
  }
});

test('an error status is not believed, whatever its body says', async () => {
  // The status line is checked before the body, because a body that happens to parse is not
  // permission to read it. A 503 carrying a stale `failed` would otherwise put that verdict
  // on screen.
  for (const code of [400, 404, 429, 500, 503]) {
    await withServer(() => ({ code, body: watch({ state: 'failed' }) }), async mod => {
      assert.equal(await mod.readWatch('arbitrum', HASH), null, `status ${code} was believed`);
    });
  }
});

test('a backend answering nonsense reads as no opinion, not as failure', async () => {
  await withServer(() => ({ code: 200, body: { state: 'exploded' } }), async mod => {
    assert.equal(await mod.readWatch('arbitrum', HASH), null);
  });
});

test('an answer about another hash is discarded rather than shown', async () => {
  await withServer(() => ({ code: 200, body: watch({ hash: OTHER, state: 'failed' }) }), async mod => {
    assert.equal(await mod.readWatch('arbitrum', HASH), null);
  });
});

test('a malformed hash is never put in the request url', async () => {
  await withServer(() => ({ code: 200, body: watch() }), async (mod, seen) => {
    assert.equal(await mod.readWatch('arbitrum', '0xnope'), null);
    assert.equal(await mod.watchTransfer('arbitrum', '../../v1/rpc/arbitrum'), null);
    assert.deepEqual(seen, []);
  });
});

test('no backend configured means no request and no opinion', async () => {
  delete process.env['EXPO_PUBLIC_WALLY_PROXY_URL'];
  const specifier = '../src/services/transfer-watch.ts?case=nobackend';
  const mod = await import(specifier);
  assert.equal(await mod.readWatch('arbitrum', HASH), null);
  assert.equal(await mod.watchTransfer('arbitrum', HASH), null);
});
