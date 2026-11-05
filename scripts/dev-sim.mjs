// Local UI simulator: no wallet, model, RPC, or production database is loaded.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const port = Number(process.env.SIM_PORT || 3000);
const root = new URL('../public/', import.meta.url);
const files = new Map([['/app.js', ['app.js', 'text/javascript']], ['/reach.css', ['reach.css', 'text/css']]]);

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ mode: 'simulation', inference: 'scripted', wallet: 'mock', funds: 'fictional' }));
  }
  if (url.pathname === '/sim-client.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(readFileSync(new URL('./sim-client.js', import.meta.url)));
  }
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(readFileSync(new URL('reach.html', root), 'utf8')
      .replace('<title>Wally — The Reach</title>', '<title>Wally — Local Simulation</title>')
      .replace('on-device agentic finance', 'SIMULATION · fictional funds')
      .replace('Signed on this device. Nothing leaves your hands until you say so.', 'Simulation only. No signing or real funds.')
      .replace('saved on this device', 'demo chats · in this browser tab')
      .replace('href="http://localhost:3001"', 'href="/simulation-notes"')
      .replace('<body>', '<body><div style="position:relative;z-index:100;padding:10px;text-align:center;background:#f2a03d;color:#10251b;font-weight:bold">LOCAL SIMULATION — scripted replies, fictional funds, no signing or blockchain access</div><script src="/sim-client.js"></script>'));
  }
  if (url.pathname === '/simulation-notes') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Local UI simulation\n\nTry: what is my balance; history; what is my arbitrum address; send 10 USDT to 0x1111111111111111111111111111111111111111 on arbitrum.\n\nSupports chat sessions, demo balances, address cards, transfer confirm/cancel and 60-second expiry. Browser-tab storage only. Only Arbitrum USDT sends are simulated. Swaps, lending and prices are not fabricated. No QVAC, keys, wallet subprocess, RPC or production database.\n\nRestart: npm run dev:sim\nReal app: npm run dev, after configuring its required dependencies.');
  }
  const entry = files.get(url.pathname);
  if (!entry) { res.writeHead(404); return res.end('Not found'); }
  let content = readFileSync(new URL(entry[0], root), 'utf8');
  if (entry[0] === 'app.js') content = content
    .replace('esc(networkMode.toUpperCase())', '\"SIMULATION"')
    .replace('All inference runs on this device through QVAC. No cloud, no API keys.', 'SIMULATION: scripted replies. No QVAC, keys or blockchain connection.')
    .replace('You are on TESTNET. Funds here are test tokens with no real value.', 'Fictional demo balances only. No testnet transactions are sent.');
  res.setHeader('Content-Type', `${entry[1]}; charset=utf-8`);
  res.end(content);
}).listen(port, '127.0.0.1', () => console.log(`Wally local simulation: http://127.0.0.1:${port} — no real funds or AI`));
