import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createWalletApi } from '../scripts/wallet-api-server.mjs';
import { createWalletService, ethDisplay, ethUnits, QuoteBook, visibleRecord } from '../scripts/wallet-api-core.mjs';

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
test('WDK signs only the reviewed transaction; uncertain broadcast survives restart without a duplicate', async () => {
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
