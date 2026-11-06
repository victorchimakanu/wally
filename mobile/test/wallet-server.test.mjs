import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createWalletApi } from '../scripts/wallet-api-server.mjs';
import { createWalletService, ethDisplay, ethUnits, QuoteBook, visibleRecord, superseded, SETTLED, manualResolve, tokenDisplay } from '../scripts/wallet-api-core.mjs';

/**
 * The signing tests need the isolated WDK runtime, which is a separate install. Until
 * 23 Oct 2026 this file was not in `npm test` at all and errored outright on a fresh
 * checkout, so the most safety-critical code in the repo had tests that never ran.
 *
 * It is in `npm test` now. The cases that need WDK skip with a visible reason when the
 * runtime is missing, rather than failing the suite or — worse — being quietly absent.
 */
const WDK_READY = (() => {
  // Check the isolated runtime's own node_modules, not `require.resolve` from it: Node walks
  // UP the tree, so resolving @tetherto/wdk-wallet-evm succeeds from the repo-root
  // node_modules even when the isolated runtime is absent. That false positive is why this
  // guard did not work on the first attempt.
  const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal/wallet-api-runtime');
  return ['@tetherto/wdk-wallet-evm', 'qrcode'].every(pkg => existsSync(path.join(runtime, 'node_modules', pkg)));
})();
const needsWdk = { skip: WDK_READY ? false : 'run: npm run wallet:install' };

test('exact ETH units do not round away wei', () => { assert.equal(ethUnits('0.000000000000000001'), 1n); assert.equal(ethDisplay(1000000000000000001n), '1.000000000000000001'); for (const value of ['0', '-1', '1e2', '0.0000000000000000001']) assert.throws(() => ethUnits(value)); });
test('reviews require the same session, approval, freshness and single use', () => {
  let now = 1000; const book = new QuoteBook(() => now), q = book.create('alice', { amount: '1' });
  assert.throws(() => book.claim('bob', q.id, true), /another session/); assert.throws(() => book.claim('alice', q.id, false), /approval/);
  book.claim('alice', q.id, true); assert.throws(() => book.claim('alice', q.id, true), /already submitted/);
  const expired = book.create('alice', {}); now = expired.expiresAt; assert.throws(() => book.claim('alice', expired.id, true), /expired/);
  assert.deepEqual(visibleRecord({ owner: 'private-session', hash: 'public' }), { hash: 'public' });
});
test('local HTTP API rejects unauthorized origins, missing sessions and non-JSON sends', async () => {
  let confirmations = 0;
  const port = 32700 + Math.floor(Math.random() * 1000), url = `http://127.0.0.1:${port}`;
  const service = { wallet: async () => ({ real: true }), confirm: async (_, body) => { if (body.approved !== true) throw new Error('Explicit approval is required.'); confirmations++; return { status: 'pending' }; } };
  const server = createWalletApi(service, { port }); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    assert.equal((await fetch(url + '/api/wallet')).status, 401);
    assert.equal((await fetch(url + '/api/wallet/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
    const wrongHostStatus = await new Promise((resolve, reject) => { const req = request(url + '/health', { headers: { Host: `evil.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(wrongHostStatus, 403);
    const session = await fetch(url + '/api/wallet/session', { headers: { Origin: 'http://127.0.0.1:8082' } });
    const cookie = session.headers.get('set-cookie').split(';')[0]; assert.match(session.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal((await fetch(url + '/api/wallet', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(url + '/api/wallet/confirm', { method: 'POST', headers: { Cookie: cookie }, body: '{}' })).status, 415);
    assert.equal((await fetch(url + '/api/wallet/confirm', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"approved":false}' })).status, 400);
    assert.equal(confirmations, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('WDK signs only the reviewed transaction; uncertain broadcast survives restart without a duplicate', needsWdk, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal');
  const directory = mkdtempSync(path.join(root, 'wallet-test-'));
  let broadcasts = 0, accepted = false, nonce = '0x0', service;
  const transport = async (url, options) => {
    if (url.includes('blockscout')) return Response.json({ items: [] });
    const request = JSON.parse(options.body), chainId = url.includes('arbitrum') ? '0x66eee' : '0xaa36a7';
    let result;
    switch (request.method) {
      case 'eth_chainId': result = chainId; break;
      case 'eth_getBalance': result = '0xde0b6b3a7640000'; break;
      case 'eth_getCode': result = '0x'; break;
      case 'eth_estimateGas': result = '0x5208'; break;
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
      case 'eth_getTransactionCount': result = nonce; break;
      case 'eth_getBlockByNumber': result = { hash: '0x' + '1'.repeat(64), parentHash: '0x' + '0'.repeat(64), number: '0x1', timestamp: '0x1', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x1111111111111111111111111111111111111111', extraData: '0x', transactions: [], baseFeePerGas: '0x1' }; break;
      case 'eth_sendRawTransaction': broadcasts++; assert.match(request.params[0], /^0x/); throw new Error('Response lost after submission');
      case 'eth_getTransactionReceipt': result = accepted ? { status: '0x1', blockNumber: '0x2' } : null; break;
      // A receipt alone is not finality: receipt() requires the block to be buried before it
      // will say confirmed, so the mock has to report a head deep enough past block 0x2.
      case 'eth_blockNumber': result = '0x9'; break;
      default: throw new Error(`Unexpected mock RPC: ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  try {
    service = await createWalletService(directory, { transport });
    await assert.rejects(service.quote('alice', { chain: 'constructor', recipient: '0x1111111111111111111111111111111111111111', amount: '0.001' }), /Choose a test network/);
    const q = await service.quote('alice', { chain: 'arbitrum', recipient: '0x1111111111111111111111111111111111111111', amount: '0.001' });
    await assert.rejects(service.confirm('bob', { quoteId: q.id, approved: true }), /another session/);
    const tx = await service.confirm('alice', { quoteId: q.id, approved: true }); assert.equal(tx.status, 'unknown'); assert.equal(tx.owner, undefined); assert.equal(broadcasts, 1);
    await assert.rejects(service.quote('alice', { chain: 'arbitrum', recipient: '0x1111111111111111111111111111111111111111', amount: '0.001' }), /still needs a receipt/);
    assert.equal((await service.confirm('alice', { quoteId: q.id, approved: true })).hash, tx.hash); assert.equal(broadcasts, 1);
    service.dispose(); service = await createWalletService(directory, { transport });
    assert.equal((await service.confirm('alice', { quoteId: q.id, approved: true })).hash, tx.hash); assert.equal(broadcasts, 1);
    accepted = true; const receipt = await service.receipt('arbitrum', tx.hash); assert.equal(receipt.status, 'confirmed'); assert.equal(receipt.blockNumber, 2); assert.equal(receipt.owner, undefined);
    const changed = await service.quote('alice', { chain: 'arbitrum', recipient: '0x1111111111111111111111111111111111111111', amount: '0.001' }); nonce = '0x1';
    await assert.rejects(service.confirm('alice', { quoteId: changed.id, approved: true }), /nonce changed/); assert.equal(broadcasts, 1);
  } finally { service?.dispose(); assert.equal(path.dirname(directory), root); assert.match(path.basename(directory), /^wallet-test-/); rmSync(directory, { recursive: true, force: true }); }
});

test('a broadcast the node refuses is explained, not silently swallowed', needsWdk, async () => {
  // Measured 23 Oct 2026: a definitively refused broadcast ("nonce too low") resolved
  // confirm() successfully, left the record 'unknown' with no explanation, and — because
  // quote() blocks on an unresolved record — permanently prevented sending on that chain.
  // No number of receipt checks helps: the transaction was never broadcast, so there is
  // never a receipt. See docs/send-path-lockout.md for the part still open.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal');
  const directory = mkdtempSync(path.join(root, 'refused-'));
  const transport = async (url, options) => {
    if (url.includes('blockscout')) return Response.json({ items: [] });
    const request = JSON.parse(options.body), chainId = url.includes('arbitrum') ? '0x66eee' : '0xaa36a7';
    let result;
    switch (request.method) {
      case 'eth_chainId': result = chainId; break;
      case 'eth_getBalance': result = '0xde0b6b3a7640000'; break;
      case 'eth_getCode': result = '0x'; break;
      case 'eth_estimateGas': result = '0x5208'; break;
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_getBlockByNumber': result = { hash: '0x' + '1'.repeat(64), parentHash: '0x' + '0'.repeat(64), number: '0x1', timestamp: '0x1', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x1111111111111111111111111111111111111111', extraData: '0x', transactions: [], baseFeePerGas: '0x1' }; break;
      // The node answers, and refuses. This transaction will never be accepted.
      case 'eth_sendRawTransaction': return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'nonce too low' } });
      case 'eth_getTransactionReceipt': result = null; break;
      case 'eth_blockNumber': result = '0x9'; break;
      default: throw new Error(`Unexpected mock RPC: ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  let service;
  try {
    service = await createWalletService(directory, { transport });
    const to = '0x1111111111111111111111111111111111111111';
    const quote = await service.quote('alice', { chain: 'arbitrum', recipient: to, amount: '0.001' });
    const record = await service.confirm('alice', { quoteId: quote.id, approved: true });

    // The hash and the unknown status stay: a lost response may still have arrived, and that
    // behaviour must not change. What must not stay is the silence.
    assert.equal(record.status, 'unknown');
    assert.match(record.rejection ?? '', /nonce too low/, 'the node\'s reason must reach the user');
  } finally {
    service?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a receipt that is not buried yet is pending, not confirmed', needsWdk, async () => {
  // Until 5 Nov 2026 a receipt alone meant "confirmed". A chain reorganisation can remove a
  // block that already had one, so Wally could tell someone their money had arrived and never
  // correct itself when it had not.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../internal');
  const directory = mkdtempSync(path.join(root, 'depth-'));
  let head = '0x2';                       // the receipt's own block: depth 1
  const transport = async (url, options) => {
    if (url.includes('blockscout')) return Response.json({ items: [] });
    const request = JSON.parse(options.body), chainId = url.includes('arbitrum') ? '0x66eee' : '0xaa36a7';
    let result;
    switch (request.method) {
      case 'eth_chainId': result = chainId; break;
      case 'eth_getBalance': result = '0xde0b6b3a7640000'; break;
      case 'eth_getCode': result = '0x'; break;
      case 'eth_estimateGas': result = '0x5208'; break;
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': result = '0x3b9aca00'; break;
      case 'eth_getTransactionCount': result = '0x0'; break;
      case 'eth_blockNumber': result = head; break;
      case 'eth_getBlockByNumber': result = { hash: '0x' + '1'.repeat(64), parentHash: '0x' + '0'.repeat(64), number: '0x1', timestamp: '0x1', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x1111111111111111111111111111111111111111', extraData: '0x', transactions: [], baseFeePerGas: '0x1' }; break;
      case 'eth_sendRawTransaction': result = null; break;
      case 'eth_getTransactionReceipt': result = { status: '0x1', blockNumber: '0x2' }; break;
      default: throw new Error(`Unexpected mock RPC: ${request.method}`);
    }
    return Response.json({ jsonrpc: '2.0', id: request.id, result });
  };
  let service;
  try {
    service = await createWalletService(directory, { transport });
    const hash = '0x' + 'a'.repeat(64);

    // Depth 1: on chain, but not yet safe to say so.
    assert.equal((await service.receipt('arbitrum', hash)).status, 'pending', 'depth 1 must not be confirmed');

    // Bury it and the same receipt becomes confirmed.
    head = '0x9';
    assert.equal((await service.receipt('arbitrum', hash)).status, 'confirmed');
  } finally {
    service?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('superseded: a nonce the chain has moved past can never land, and everything else stays pending', () => {
  // The rule that unwedges a chain, so the cases are the ones where being wrong costs money.
  // It must never say "dead" about a transfer that could still arrive — that is how someone
  // sends the same money twice.
  assert.equal(superseded({ hasReceipt: false, recordNonce: 7, confirmedNonce: 8 }), true, 'the nonce was spent by something else');
  assert.equal(superseded({ hasReceipt: false, recordNonce: 7, confirmedNonce: 99 }), true);

  assert.equal(superseded({ hasReceipt: false, recordNonce: 7, confirmedNonce: 7 }), false, 'still the next nonce: in flight');
  assert.equal(superseded({ hasReceipt: false, recordNonce: 7, confirmedNonce: 6 }), false, 'the chain is behind this transfer');
  assert.equal(superseded({ hasReceipt: true, recordNonce: 7, confirmedNonce: 99 }), false, 'a receipt settles it, whatever the nonce says');

  // A record written before nonces were journalled cannot be judged. It must not be guessed
  // at — those go through the explicit user action instead.
  for (const missing of [undefined, null, NaN, '7', 7.5, Infinity]) {
    assert.equal(superseded({ hasReceipt: false, recordNonce: missing, confirmedNonce: 99 }), false, `recordNonce ${String(missing)}`);
    assert.equal(superseded({ hasReceipt: false, recordNonce: 7, confirmedNonce: missing }), false, `confirmedNonce ${String(missing)}`);
  }

  // Nonce 0 is a real nonce — the first transfer a wallet ever makes.
  assert.equal(superseded({ hasReceipt: false, recordNonce: 0, confirmedNonce: 1 }), true);
  assert.equal(superseded({ hasReceipt: false, recordNonce: 0, confirmedNonce: 0 }), false);
});

test('SETTLED is exactly the statuses that stop blocking the chain', () => {
  // quote() refuses while anything on a chain is unsettled, so this list is the difference
  // between a usable wallet and a permanently wedged one.
  assert.deepEqual([...SETTLED].sort(), ['confirmed', 'failed', 'superseded']);
  for (const blocking of ['unknown', 'pending']) {
    assert.equal(SETTLED.includes(blocking), false, `${blocking} must keep blocking`);
  }
});

test('marking a transfer as never arrived is refused whenever the chain can answer instead', () => {
  // The refusal is the point. Letting a person override a judgement Wally can make itself is
  // the one way this mechanism could cause a double-send: a slow transfer declared dead, the
  // chain unblocked, the same money sent twice.
  assert.deepEqual(manualResolve({ status: 'unknown', nonce: 4 }).allowed, false, 'a nonce means the chain can be asked');
  assert.match(manualResolve({ status: 'unknown', nonce: 4 }).reason, /may arrive/);
  assert.deepEqual(manualResolve({ status: 'pending', nonce: 0 }).allowed, false, 'nonce 0 is a real nonce');

  // Only the records Wally genuinely cannot judge.
  assert.deepEqual(manualResolve({ status: 'unknown' }), { allowed: true });
  assert.deepEqual(manualResolve({ status: 'pending', nonce: undefined }), { allowed: true });

  // Already settled: nothing to do, and not an error either.
  for (const status of SETTLED) {
    assert.equal(manualResolve({ status }).allowed, false, status);
    assert.equal(manualResolve({ status }).reason, 'settled', status);
  }

  assert.equal(manualResolve(undefined).allowed, false);
  assert.equal(manualResolve(null).allowed, false);
});

test('the dev server builds a snapshot the app will actually accept', async () => {
  // The loop neither side closes on its own: the dev server formats balances and the app
  // validates them, with three separate copies of the token list between them. A disagreement
  // about USDt's decimals does not raise an error anywhere — it shows a different amount. So
  // the server's output is built here exactly as `wallet()` builds it and run through the
  // app's real parser.
  const { TOKENS, tokenDisplay, NETWORKS } = await import('../scripts/wallet-api-core.mjs');
  const { parseWallet } = await import('../src/services/wallet-api.ts');

  const address = '0x1111111111111111111111111111111111111111';
  const qr = 'data:image/svg+xml;base64,PHN2Zy8+';
  const balances = Object.entries(NETWORKS).flatMap(([chain, network]) => {
    const common = { chain, name: network.name, chainId: network.chainId, address, qr, error: '' };
    return [
      { ...common, symbol: 'ETH', balanceWei: '1000000000000000', balance: '0.001' },
      ...(TOKENS[chain] ?? []).map(token => ({
        ...common,
        symbol: token.symbol,
        balanceWei: '10500000',
        balance: tokenDisplay('10500000', token.decimals),
      })),
    ];
  });

  const snapshot = { version: 1, network: 'testnet', location: 'computer', fetchedAt: Date.now(), balances, tokenNotice: 'x' };
  const parsed = parseWallet(snapshot);

  const usdt = parsed.balances.find(item => item.symbol === 'USDT');
  assert.ok(usdt, 'the snapshot must carry USDt');
  // 10_500_000 base units at six decimals is 10.5 — the number a person reads. If either side
  // used eighteen, parseWallet would have thrown above.
  assert.equal(usdt.balance, '10.5');
  assert.equal(parsed.balances.filter(item => item.symbol === 'ETH').length, 2);
});

test('tokenDisplay scales by the token decimals, not by eighteen', () => {
  assert.equal(tokenDisplay('1000000', 6), '1');
  assert.equal(tokenDisplay('10500000', 6), '10.5');
  assert.equal(tokenDisplay('1', 6), '0.000001');
  assert.equal(tokenDisplay('0', 6), '0');
  assert.equal(tokenDisplay('5', 0), '5');
  // The same integer under the two scales must differ, or the bug is present.
  assert.notEqual(tokenDisplay('1000000', 6), tokenDisplay('1000000', 18));
});
