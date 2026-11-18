import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { LiveHistory, LiveTransaction } from '../src/services/wallet-api.ts';

/**
 * Activity reads indexed history from the Wally backend when one is configured. These cases
 * cover the request the app actually sends, without reaching a real indexer.
 *
 * The merge rules used to live here too, against a `mergeHistory` that merged one indexed
 * response with this device's submissions. Activity now reads the backend one chain and one
 * page at a time, so the merge is `withLocalSubmissions` in `history-pager.ts` and its rules
 * are tested beside it, over a list that pages rather than one response that could not.
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
