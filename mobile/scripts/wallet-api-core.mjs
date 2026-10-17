import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const NETWORKS = {
  arbitrum: { name: 'Arbitrum Sepolia', chainId: 421614, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io', indexer: 'https://arbitrum-sepolia.blockscout.com' },
  ethereum: { name: 'Ethereum Sepolia', chainId: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', indexer: 'https://eth-sepolia.blockscout.com' },
};
export function ethUnits(text) {
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/.test(text)) throw new Error('Enter an ETH amount with up to 18 decimals.');
  const [whole, fraction = ''] = text.split('.');
  const value = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (value <= 0n) throw new Error('The amount must be positive.');
  return value;
}
export function ethDisplay(value) { const n = BigInt(value), whole = n / 10n ** 18n, fraction = (n % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return `${whole}${fraction ? '.' + fraction : ''}`; }
export function validAddress(address) { return typeof address === 'string' && /^0x[\da-fA-F]{40}$/.test(address) && !/^0x0{40}$/i.test(address); }
export function visibleRecord(record) { const { owner, ...visible } = record; return visible; }
export class QuoteBook {
  constructor(now = Date.now) { this.now = now; this.items = new Map(); }
  create(owner, payload) {
    for (const [id, quote] of this.items) if (quote.expiresAt <= this.now()) this.items.delete(id);
    if (this.items.size >= 128) throw new Error('Too many pending reviews. Try again later.');
    const quote = { ...payload, id: randomUUID(), owner, expiresAt: this.now() + 60000, claimed: false };
    this.items.set(quote.id, quote); return quote;
  }
  claim(owner, id, approved) {
    const quote = this.items.get(id);
    if (!quote || quote.owner !== owner) throw new Error('This review belongs to another session or is no longer available.');
    if (approved !== true) throw new Error('Explicit approval is required.');
    if (quote.claimed) throw new Error('This review was already submitted. Check its receipt before trying another transfer.');
    if (quote.expiresAt <= this.now()) throw new Error('This review expired. Request a fresh fee estimate.');
    quote.claimed = true; return quote;
  }
}
export async function createWalletService(directory, { transport = fetch } = {}) {
  const runtime = path.join(directory, '..', 'wallet-api-runtime');
  const require = createRequire(path.join(runtime, 'package.json'));
  let WalletManagerEvm, ethers, qr;
  try { ({ default: WalletManagerEvm } = await import(pathToFileURL(require.resolve('@tetherto/wdk-wallet-evm')).href)); ethers = await import(pathToFileURL(require.resolve('ethers')).href); qr = require('qrcode'); }
  catch { throw new Error('Install the isolated WDK runtime with npm install --prefix internal/wallet-api-runtime --save-exact @tetherto/wdk-wallet-evm@1.0.0-beta.14 qrcode@1.5.4'); }
  mkdirSync(directory, { recursive: true });
  const seedFile = path.join(directory, 'wallet.seed');
  let phrase;
  if (existsSync(seedFile)) { phrase = readFileSync(seedFile, 'utf8').trim(); if (!ethers.Mnemonic.isValidMnemonic(phrase)) throw new Error('The testnet wallet seed is invalid. Restore its backup; a replacement was not generated.'); }
  else { phrase = ethers.Wallet.createRandom().mnemonic.phrase; writeFileSync(seedFile, phrase + '\n', { mode: 0o600, flag: 'wx' }); }
  try { chmodSync(seedFile, 0o600); } catch {}
  const journalFile = path.join(directory, 'transactions.json');
  let journal = [];
  if (existsSync(journalFile)) { journal = JSON.parse(readFileSync(journalFile, 'utf8')); if (!Array.isArray(journal) || !journal.every(item => NETWORKS[item.chain] && /^0x[\da-f]{64}$/i.test(item.hash) && ['unknown', 'pending', 'confirmed', 'failed'].includes(item.status))) throw new Error('The transaction journal is invalid. Restore it before submitting transfers.'); }
  const save = () => { writeFileSync(journalFile + '.tmp', JSON.stringify(journal, null, 2), { mode: 0o600 }); renameSync(journalFile + '.tmp', journalFile); };
  const book = new QuoteBook();
  const managers = new Map(), accounts = new Map(), accountInfo = new Map();
  let rpcId = 0, sending = false;
  async function rpc(chain, method, params = []) {
    if (!Object.hasOwn(NETWORKS, chain)) throw new Error('Unsupported test network.');
    const network = NETWORKS[chain];
    const response = await transport(network.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${network.name} RPC is unavailable.`);
    const data = await response.json(); if (data.error || !Object.hasOwn(data, 'result')) throw new Error(`${network.name} could not complete the ${method} request.`);
    return data.result;
  }
  async function checked(chain) { const actual = Number(BigInt(await rpc(chain, 'eth_chainId'))); if (actual !== NETWORKS[chain].chainId) throw new Error('RPC network mismatch. Testnet operations were blocked.'); }
  async function account(chain) {
    if (!Object.hasOwn(NETWORKS, chain)) throw new Error('Only Arbitrum Sepolia and Ethereum Sepolia are enabled.');
    if (!accounts.has(chain)) { const manager = new WalletManagerEvm(phrase, { provider: { request: ({ method, params }) => rpc(chain, method, params) }, transactionMaxFee: 10n ** 16n }); managers.set(chain, manager); accounts.set(chain, await manager.getAccount(0)); }
    return accounts.get(chain);
  }
  for (const chain of Object.keys(NETWORKS)) { const a = await account(chain), address = await a.getAddress(); if (!validAddress(address)) throw new Error('WDK returned an invalid address.'); const svg = await qr.toString(address, { type: 'svg', width: 160, margin: 2 }); accountInfo.set(chain, { address, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }); }
  // Managers retain the seed internally. No API response includes the seed or signed bytes.
  phrase = null;
  async function wallet() {
    const balances = await Promise.all(Object.entries(NETWORKS).map(async ([chain, network]) => {
      const info = accountInfo.get(chain);
      try { await checked(chain); const value = await (await account(chain)).getBalance(); return { chain, name: network.name, chainId: network.chainId, symbol: 'ETH', ...info, balanceWei: value.toString(), balance: ethDisplay(value), error: '' }; }
      catch { return { chain, name: network.name, chainId: network.chainId, symbol: 'ETH', ...info, balanceWei: null, balance: null, error: `${network.name} balance could not be refreshed.` }; }
    }));
    return { version: 1, network: 'testnet', location: 'computer', fetchedAt: Date.now(), balances, tokenNotice: 'Native testnet ETH is connected. USDt requires an explicitly configured testnet token contract; gas is paid in ETH.' };
  }
  async function quote(owner, body) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['chain', 'recipient', 'amount'].includes(key)) || !Object.hasOwn(NETWORKS, body.chain) || !validAddress(body.recipient)) throw new Error('Choose a test network and enter a complete recipient address.');
    const recipient = ethers.getAddress(body.recipient), value = ethUnits(body.amount), chain = body.chain;
    await checked(chain);
    for (const pending of journal.filter(item => item.chain === chain && ['unknown', 'pending'].includes(item.status))) {
      try { await receipt(chain, pending.hash); } catch {}
      if (['unknown', 'pending'].includes(pending.status)) throw new Error('A transfer on this network still needs a receipt. Resolve it in Activity before creating another send.');
    }
    const info = accountInfo.get(chain), a = await account(chain);
    const balance = await a.getBalance(); if (balance < value) throw new Error('Not enough testnet ETH. Fund this address from a faucet before sending.');
    if (await rpc(chain, 'eth_getCode', [recipient, 'latest']) !== '0x') throw new Error('This native ETH send supports ordinary wallet recipients. Contract interactions need their own review.');
    const [gasHex, gasPriceHex, nonceHex] = await Promise.all([rpc(chain, 'eth_estimateGas', [{ from: info.address, to: recipient, value: ethers.toQuantity(value), data: '0x' }]), rpc(chain, 'eth_gasPrice'), rpc(chain, 'eth_getTransactionCount', [info.address, 'pending'])]);
    const gasLimit = BigInt(gasHex), gasPrice = BigInt(gasPriceHex), fee = gasLimit * gasPrice;
    if (fee <= 0n || fee > 10n ** 16n || gasLimit > 1000000n) throw new Error('The fee estimate is outside the configured testnet limit.');
    if (balance < value + fee) throw new Error('Not enough testnet ETH to cover the amount and network fee.');
    const tx = { to: recipient, value, data: '0x', chainId: NETWORKS[chain].chainId, nonce: Number(BigInt(nonceHex)), gasLimit, gasPrice, type: 0 };
    const wdkQuote = await a.quoteSendTransaction(tx); if (wdkQuote.fee > 10n ** 16n) throw new Error('WDK rejected the network fee limit.');
    const entry = book.create(owner, { chain, recipient, amount: ethers.formatEther(value), fee: ethers.formatEther(fee), feeWei: fee.toString(), total: ethers.formatEther(value + fee), from: info.address, tx });
    return { id: entry.id, chain, network: NETWORKS[chain].name, recipient, amount: entry.amount, fee: entry.fee, total: entry.total, from: entry.from, expiresAt: entry.expiresAt, symbol: 'ETH', chainId: NETWORKS[chain].chainId };
  }
  async function confirm(owner, body) {
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !['quoteId', 'approved'].includes(key)) || typeof body.quoteId !== 'string' || body.approved !== true) throw new Error('Confirm the exact reviewed quote before submitting.');
    const previous = journal.find(item => item.quoteId === body.quoteId && item.owner === owner); if (previous) return visibleRecord(previous);
    if (sending) throw new Error('A transfer is already being submitted. Check its receipt first.');
    const q = book.claim(owner, body.quoteId, body.approved); sending = true;
    try {
      if (journal.some(item => item.chain === q.chain && ['unknown', 'pending'].includes(item.status))) throw new Error('A transfer on this network still needs a receipt. Check Activity before sending again.');
      await checked(q.chain);
      const a = await account(q.chain), tx = q.tx;
      const balance = await a.getBalance(); if (balance < tx.value + BigInt(q.feeWei)) throw new Error('The balance changed. Request a fresh review.');
      const nonce = Number(BigInt(await rpc(q.chain, 'eth_getTransactionCount', [q.from, 'pending']))); if (nonce !== tx.nonce) throw new Error('The wallet nonce changed. Request a fresh review.');
      if (await rpc(q.chain, 'eth_getCode', [q.recipient, 'latest']) !== '0x') throw new Error('The recipient changed. Request a fresh review.');
      const requiredGas = BigInt(await rpc(q.chain, 'eth_estimateGas', [{ from: q.from, to: q.recipient, value: ethers.toQuantity(tx.value), data: '0x' }])); if (requiredGas > tx.gasLimit) throw new Error('The fee estimate changed. Request a fresh review.');
      const raw = await a.signTransaction(tx), decoded = ethers.Transaction.from(raw);
      if (decoded.to !== tx.to || decoded.from?.toLowerCase() !== q.from.toLowerCase() || decoded.value !== tx.value || decoded.data !== '0x' || decoded.chainId !== BigInt(tx.chainId) || decoded.nonce !== tx.nonce || decoded.gasLimit !== tx.gasLimit || decoded.gasPrice !== tx.gasPrice || decoded.type !== 0) throw new Error('The signed transaction did not match the approved review. Nothing was broadcast.');
      const hash = ethers.keccak256(raw);
      const record = { quoteId: q.id, owner, hash, chain: q.chain, network: NETWORKS[q.chain].name, from: q.from, recipient: q.recipient, amount: q.amount, fee: q.fee, status: 'unknown', submittedAt: Date.now(), explorerUrl: `${NETWORKS[q.chain].explorer}/tx/${hash}`, symbol: 'ETH' };
      journal.unshift(record); save();
      try { const returned = await rpc(q.chain, 'eth_sendRawTransaction', [raw]); if (returned?.toLowerCase() === hash.toLowerCase()) record.status = 'pending'; } catch { /* The broadcast may have arrived. Keep its known hash and check receipts. */ }
      save(); return visibleRecord(record);
    } finally { sending = false; }
  }
  async function receipt(chain, hash) {
    if (!Object.hasOwn(NETWORKS, chain) || !/^0x[\da-f]{64}$/i.test(hash)) throw new Error('Invalid transaction lookup.');
    await checked(chain); const result = await rpc(chain, 'eth_getTransactionReceipt', [hash]);
    const record = journal.find(item => item.hash.toLowerCase() === hash.toLowerCase() && item.chain === chain);
    const status = result ? BigInt(result.status) === 1n ? 'confirmed' : 'failed' : record?.status ?? 'pending';
    if (record && record.status !== status) { record.status = status; save(); }
    return { ...(record ? visibleRecord(record) : { hash, chain, explorerUrl: `${NETWORKS[chain].explorer}/tx/${hash}` }), status, blockNumber: result?.blockNumber ? Number(BigInt(result.blockNumber)) : null, checkedAt: Date.now() };
  }
  async function history() {
    const errors = [], items = [];
    await Promise.all(Object.entries(NETWORKS).map(async ([chain, network]) => {
      try { const response = await transport(`${network.indexer}/api/v2/addresses/${accountInfo.get(chain).address}/transactions`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(); const data = await response.json(); if (!Array.isArray(data.items)) throw new Error(); for (const item of data.items.slice(0, 25)) { if (!/^0x[\da-f]{64}$/i.test(item.hash) || !/^\d+$/.test(String(item.value))) continue; items.push({ hash: item.hash, chain, network: network.name, from: item.from?.hash ?? '', recipient: item.to?.hash ?? '', amount: ethDisplay(item.value), symbol: 'ETH', status: item.status === 'ok' ? 'confirmed' : item.status === 'error' ? 'failed' : 'pending', submittedAt: Date.parse(item.timestamp) || 0, explorerUrl: `${network.explorer}/tx/${item.hash}` }); } }
      catch { errors.push(`${network.name} history is unavailable. Showing locally tracked submissions where available.`); }
    }));
    await Promise.all(journal.slice(0, 25).map(async record => { try { await receipt(record.chain, record.hash); } catch {} if (!items.some(item => item.hash === record.hash && item.chain === record.chain)) items.push(visibleRecord(record)); }));
    return { version: 1, source: 'Blockscout and local submission receipts', fetchedAt: Date.now(), items: items.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 50), errors };
  }
  return { wallet, quote, confirm, receipt, history, dispose: () => { for (const manager of managers.values()) manager.dispose(); }, seedFile };
}
export function newSession() { return randomBytes(32).toString('hex'); }
