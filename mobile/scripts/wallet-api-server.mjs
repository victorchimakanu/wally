/**
 * DEVELOPMENT ONLY — NOT A PRODUCTION PATH.
 *
 * This server keeps the wallet seed on the developer's computer at
 * internal/testnet-wallet/wallet.seed and serves one wallet over loopback.
 * It is single-user by construction and must never become a hosted service.
 *
 * Superseded for production by on-device signing in a WDK Bare worklet.
 * See docs/ADR-001-key-custody.md and mobile/wdk.config.js.
 *
 * Keep using it for desktop development and the existing mocked tests. Do not
 * add features here, and do not point a shipped build at it.
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createWalletService, newSession } from './wallet-api-core.mjs';

export function createWalletApi(service, { port = 3003, origins = ['http://127.0.0.1:8082', 'http://localhost:8082'] } = {}) {
  const sessions = new Map(), requests = new Map();
  const cookieName = 'wally_testnet_session';
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const peer = req.socket.remoteAddress;
    const host = req.headers.host;
    const allowedHost = [`127.0.0.1:${port}`, `localhost:${port}`].includes(host);
    const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(payload)); };
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || !allowedHost || origin !== undefined && !origins.includes(origin)) return send(403, { error: 'This testnet API accepts only the configured local app.' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.writeHead(204); return res.end(); }
    const url = new URL(req.url, `http://${host}`);
    if (url.pathname === '/health') return send(200, { mode: 'testnet', wallet: 'WDK', location: 'computer', networks: ['Arbitrum Sepolia', 'Ethereum Sepolia'] });
    const cookie = String(req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    let session = cookie && sessions.has(cookie) && sessions.get(cookie) > Date.now() ? cookie : null;
    if (req.method === 'GET' && url.pathname === '/api/wallet/session') {
      if (!session) { for (const [id, expires] of sessions) if (expires < Date.now()) sessions.delete(id); if (sessions.size >= 128) return send(429, { error: 'Too many active sessions.' }); session = newSession(); }
      sessions.set(session, Date.now() + 86400000);
      res.setHeader('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/api/wallet; Max-Age=86400`);
      return send(200, { ready: true, network: 'testnet' });
    }
    if (!session) return send(401, { error: 'Connect to the local wallet API first.' });
    for (const [id, window] of requests) if (window.reset <= Date.now()) requests.delete(id);
    const window = requests.get(session) ?? { count: 0, reset: Date.now() + 60000 }; window.count++; requests.set(session, window);
    if (window.count > 60) return send(429, { error: 'Too many wallet requests. Try again shortly.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/wallet') return send(200, await service.wallet());
      if (req.method === 'GET' && url.pathname === '/api/wallet/history') return send(200, await service.history());
      if (req.method === 'GET' && url.pathname === '/api/wallet/receipt') return send(200, await service.receipt(url.searchParams.get('chain'), url.searchParams.get('hash')));
      if (req.method === 'POST' && ['/api/wallet/quote', '/api/wallet/confirm'].includes(url.pathname)) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON is required.' });
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) return send(413, { error: 'Request too large.' }); }
        let parsed; try { parsed = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
        const result = url.pathname.endsWith('/quote') ? await service.quote(session, parsed) : await service.confirm(session, parsed);
        return send(200, result);
      }
      return send(404, { error: 'Unknown API route.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet request failed.';
      // Only deliberate validation messages are exposed, never SDK errors which may include payloads.
      const safe = /^(Enter |The amount|Choose a |Only |Unsupported |Not enough |This |Explicit |Confirm |Too many |A transfer|The balance|The wallet nonce|The recipient|The fee|The signed|The review|WDK rejected|RPC network mismatch|Invalid transaction)/.test(message);
      return send(safe ? 400 : 503, { error: safe ? message : 'The wallet service could not complete this request. Check the connection and retry.' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const port = Number(process.env.WALLY_API_PORT ?? 3003);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local wallet API port.');
  const service = await createWalletService(path.join(root, 'internal/testnet-wallet'));
  const server = createWalletApi(service, { port });
  server.listen(port, '127.0.0.1', () => console.log(`WDK testnet API: http://127.0.0.1:${port} · wallet keys remain on this computer · seed saved privately under internal/testnet-wallet`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); service.dispose(); process.exit(0); });
}
