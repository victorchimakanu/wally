import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { resolveProxy } from '../src/services/market-api.ts';

/**
 * The app routes market data through the Wally backend when EXPO_PUBLIC_WALLY_PROXY_URL is
 * set, and calls CoinGecko directly when it is not. These cases cover the URL rules and the
 * response envelope without reaching any real provider.
 */

test('proxy url is accepted only when it is safe to call', () => {
  assert.equal(resolveProxy('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(resolveProxy('https://api.wally.example'), 'https://api.wally.example');
  // A trailing slash is normalised away so path joining cannot double up.
  assert.equal(resolveProxy('https://api.wally.example/'), 'https://api.wally.example');
  assert.equal(resolveProxy('https://api.wally.example/base/'), 'https://api.wally.example/base');

  // Anything unsafe or unparseable falls back to calling the provider directly.
  assert.equal(resolveProxy(''), '');
  assert.equal(resolveProxy('not-a-url'), '');
  assert.equal(resolveProxy('ftp://api.wally.example'), '');
  assert.equal(resolveProxy('https://user:password@evil.test'), '', 'credentials in the url must be refused');
  assert.equal(resolveProxy('https://api.wally.example?x=1'), '', 'query smuggling must be refused');
  assert.equal(resolveProxy('https://api.wally.example#frag'), '');
});

test('market data is read through the proxy envelope, preserving the real fetch time', async () => {
  const requested: string[] = [];
  const stored = 1_700_000_000_000;
  const server: Server = createServer((request, response) => {
    requested.push(request.url ?? '');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    // Mirrors the backend contract: { currency, fetchedAt, fresh, data }.
    response.end(JSON.stringify({
      currency: 'ngn',
      fetchedAt: stored,
      fresh: false,
      data: [{ id: 'bitcoin', current_price: 108_000_000, price_change_percentage_24h: 1.5 }],
    }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    process.env.EXPO_PUBLIC_WALLY_PROXY_URL = `http://127.0.0.1:${port}`;
    // Imported after the variable is set: the module resolves its base url on load.
    const { fetchMarket } = await import(`../src/services/market-api.ts?proxy=${port}`);
    const snapshot = await fetchMarket('NGN');

    assert.equal(requested[0], '/v1/market?currency=ngn', 'must call the proxy route, not CoinGecko');
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0].price, 108_000_000);
    assert.equal(snapshot.currency, 'NGN');
    // A stale payload keeps the time it was actually fetched, so "Saved" stays truthful.
    assert.equal(snapshot.fetchedAt, stored, 'fetchedAt must come from the proxy, not from now');
  } finally {
    delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('a proxy response missing its data envelope is rejected rather than parsed', async () => {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ currency: 'usd', fetchedAt: Date.now() }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    process.env.EXPO_PUBLIC_WALLY_PROXY_URL = `http://127.0.0.1:${port}`;
    const { fetchMarket } = await import(`../src/services/market-api.ts?missing=${port}`);
    await assert.rejects(() => fetchMarket('USD'), /unexpected response|could not be refreshed/i);
  } finally {
    delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('the app reports which market source is actually in use', async () => {
  // The query string forces Node to re-evaluate the module so it re-reads the environment.
  // Held in a variable because tsc tries to resolve a literal specifier as a real path.
  const fresh = (tag: string) => import(`../src/services/market-api.ts?src=${tag}`);

  // Default: no proxy configured, so Settings must say CoinGecko direct.
  const direct = await fresh('direct');
  assert.equal(direct.marketSource().mode, 'direct');
  assert.match(direct.marketSource().label, /CoinGecko/);

  process.env.EXPO_PUBLIC_WALLY_PROXY_URL = 'http://127.0.0.1:8080';
  const proxied = await fresh('proxy');
  delete process.env.EXPO_PUBLIC_WALLY_PROXY_URL;
  assert.equal(proxied.marketSource().mode, 'proxy');
  assert.equal(proxied.marketSource().url, 'http://127.0.0.1:8080');
  assert.equal(proxied.marketSource().label, 'Wally backend');
});
