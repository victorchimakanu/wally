import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mergeHistory, type LiveHistory, type LiveTransaction } from '../src/services/wallet-api.ts';

/**
 * Activity reads indexed history from the Wally backend when one is configured, and merges it
 * with transfers this device submitted. These cases cover the merge rules and the request the
 * app actually sends, without reaching a real indexer.
 */

const HASH = (char: string) => '0x' + char.repeat(64);
const ADDR = (char: string) => '0x' + char.repeat(40);

function tx(hash: string, over: Partial<LiveTransaction> = {}): LiveTransaction {
  return {
    hash,
    chain: 'arbitrum',
    status: 'confirmed',
    explorerUrl: `https://sepolia.arbiscan.io/tx/${hash}`,
    submittedAt: 1_700_000_000_000,
    ...over,
  };
}

function history(items: LiveTransaction[], errors: string[] = [], over: Partial<LiveHistory> = {}): LiveHistory {
  return { version: 1, fetchedAt: 1_700_000_000_000, source: 'test', items, errors, ...over };
}

test('a transfer this device just sent is not dropped by the indexed list', () => {
  // The backend cannot see a submission that has no receipt yet. If indexed history simply
  // replaced the local list, a just-sent transfer would vanish from Activity.
  const pending = tx(HASH('a'), { status: 'pending', submittedAt: 1_700_000_500_000 });
  const merged = mergeHistory(history([tx(HASH('b'))]), history([pending]));

  assert.equal(merged.items.length, 2);
  assert.equal(merged.items[0].hash, HASH('a'), 'newest first');
  assert.equal(merged.items[0].status, 'pending');
});

test('the indexed record wins a duplicate, because only it knows what confirmed', () => {
  const hash = HASH('c');
  const merged = mergeHistory(
    history([tx(hash, { status: 'confirmed', blockNumber: 500 })]),
    history([tx(hash, { status: 'pending', blockNumber: null })]),
  );

  assert.equal(merged.items.length, 1, 'the same transaction must not appear twice');
  assert.equal(merged.items[0].status, 'confirmed');
  assert.equal(merged.items[0].blockNumber, 500);
});

test('duplicates are matched regardless of hash case', () => {
  const merged = mergeHistory(
    history([tx('0x' + 'a'.repeat(64))]),
    history([tx('0x' + 'A'.repeat(64))]),
  );
  assert.equal(merged.items.length, 1);
});

test('the same hash on two chains is two transactions, not one', () => {
  const hash = HASH('d');
  const merged = mergeHistory(
    history([tx(hash, { chain: 'arbitrum' })]),
    history([tx(hash, { chain: 'ethereum', explorerUrl: `https://sepolia.etherscan.io/tx/${hash}` })]),
  );
  assert.equal(merged.items.length, 2);
});

test('the local indexer errors are dropped, and the backend errors kept', () => {
  // The local errors describe the loopback server's own Blockscout attempt, which Activity is
  // no longer built from. Repeating them would tell the user something untrue.
  const merged = mergeHistory(
    history([tx(HASH('e'))], ['Ethereum Sepolia history is unavailable right now.']),
    history([], ['Arbitrum Sepolia history is unavailable. Showing locally tracked submissions where available.']),
  );
  assert.deepEqual(merged.errors, ['Ethereum Sepolia history is unavailable right now.']);
});

test('the merged list never exceeds the 50 that parseHistory accepts', () => {
  const remote = Array.from({ length: 40 }, (_, i) => tx('0x' + `r${i}`.padStart(64, '0'), { submittedAt: 2_000_000 + i }));
  const local = Array.from({ length: 30 }, (_, i) => tx('0x' + `1${i}`.padStart(64, '0'), { submittedAt: 1_000_000 + i }));
  const merged = mergeHistory(history(remote), history(local));

  assert.equal(merged.items.length, 50);
  // The newest survive the cap, so the cap never hides a recent transfer.
  assert.equal(merged.items[0].submittedAt, 2_000_039);
});

test('the merged source names both origins, and keeps the backend fetch time', () => {
  const merged = mergeHistory(history([], [], { source: 'etherscan', fetchedAt: 1_700_000_900_000 }), history([]));
  assert.match(merged.source, /etherscan/);
  assert.match(merged.source, /this device/);
  assert.equal(merged.fetchedAt, 1_700_000_900_000);
});

test('the backend is asked for each chain by its own address', async () => {
  const requested: string[] = [];
  const server: Server = createServer((request, response) => {
    requested.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ version: 1, fetchedAt: Date.now(), source: 'etherscan', items: [], errors: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    process.env.EXPO_PUBLIC_WALLY_PROXY_URL = `http://127.0.0.1:${port}`;
    const { fetchProxyHistory } = await import('../src/services/wallet-api.ts');
    const result = await fetchProxyHistory({ arbitrum: ADDR('1'), ethereum: ADDR('2') });

    // Arbitrum's smart-account address need not equal the Ethereum EOA, so one shared
    // `address` would query the wrong account on one of the two chains.
    assert.match(requested[0], new RegExp(`address\\.arbitrum=${ADDR('1')}`));
    assert.match(requested[0], new RegExp(`address\\.ethereum=${ADDR('2')}`));
    assert.equal(result.source, 'etherscan');
  } finally {
    delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("the backend's own wording is shown when it refuses, not a generic failure", async () => {
  const server: Server = createServer((_request, response) => {
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Arbitrum Sepolia history needs an indexer API key (set ETHERSCAN_API_KEY).' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    process.env.EXPO_PUBLIC_WALLY_PROXY_URL = `http://127.0.0.1:${port}`;
    const { fetchProxyHistory } = await import(`../src/services/wallet-api.ts?refused=${port}`);
    // "needs an API key" is actionable; "Activity unavailable" sends someone to the wrong place.
    await assert.rejects(() => fetchProxyHistory({ arbitrum: ADDR('1') }), /ETHERSCAN_API_KEY/);
  } finally {
    delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('a malformed address is never put in the request url', async () => {
  const requested: string[] = [];
  const server: Server = createServer((request, response) => {
    requested.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ version: 1, fetchedAt: Date.now(), source: 'etherscan', items: [], errors: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    process.env.EXPO_PUBLIC_WALLY_PROXY_URL = `http://127.0.0.1:${port}`;
    const { fetchProxyHistory } = await import(`../src/services/wallet-api.ts?bad=${port}`);
    await fetchProxyHistory({ arbitrum: ADDR('1'), ethereum: 'not-an-address' as string });
    assert.match(requested[0], new RegExp(`address\\.arbitrum=${ADDR('1')}`));
    assert.ok(!requested[0].includes('not-an-address'), 'an invalid address must be left out entirely');

    // With nothing valid left there is nothing to ask for, so it fails rather than guessing.
    await assert.rejects(() => fetchProxyHistory({ arbitrum: '0xnope' }), /address/i);
  } finally {
    delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('history stays local when no backend is configured', async () => {
  // Held in a variable: tsc tries to resolve a literal specifier as a real file path.
  const fresh = (tag: string) => import(`../src/services/wallet-api.ts?src=${tag}`);
  const { fetchProxyHistory, historySource } = await fresh('nobackend');
  assert.equal(historySource().mode, 'local');
  await assert.rejects(() => fetchProxyHistory({ arbitrum: ADDR('1') }), /No Wally backend/);
});
