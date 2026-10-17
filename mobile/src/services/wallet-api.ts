export type Chain = 'arbitrum' | 'ethereum';
export const CHAINS = { arbitrum: { name: 'Arbitrum Sepolia', id: 421614, explorer: 'https://sepolia.arbiscan.io' }, ethereum: { name: 'Ethereum Sepolia', id: 11155111, explorer: 'https://sepolia.etherscan.io' } } as const;
export type WalletBalance = { chain: Chain; name: string; chainId: number; symbol: 'ETH'; address: string; qr: string; balance: string | null; balanceWei: string | null; error: string };
export type WalletSnapshot = { version: 1; network: 'testnet'; location: 'computer'; fetchedAt: number; balances: WalletBalance[]; tokenNotice: string };
export type LiveQuote = { id: string; chain: Chain; chainId: number; network: string; symbol: 'ETH'; from: string; recipient: string; amount: string; fee: string; total: string; expiresAt: number };
export type LiveTransaction = { hash: string; chain: Chain; status: 'unknown' | 'pending' | 'confirmed' | 'failed'; explorerUrl: string; from?: string; recipient?: string; amount?: string; fee?: string; submittedAt?: number; blockNumber?: number | null; checkedAt?: number };
export type LiveHistory = { version: 1; fetchedAt: number; source: string; items: LiveTransaction[]; errors: string[] };
export function isAddress(value: unknown): value is string { return typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value); }
export function wei(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,18})?$/.test(value)) throw new Error('Enter an ETH amount with up to 18 decimals.');
  const [whole, part = ''] = value.split('.'); return BigInt(whole) * 10n ** 18n + BigInt(part.padEnd(18, '0'));
}
/** Wei as ETH for display, cut (never rounded up) to `decimals` places; dust shows as "<0.000001". */
export function formatEth(value: bigint, decimals = 6): string {
  const whole = value / 10n ** 18n, part = (value % 10n ** 18n).toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '');
  if (whole === 0n && !part && value > 0n) return `<0.${'0'.repeat(decimals - 1)}1`;
  return `${whole.toLocaleString('en-US')}${part ? `.${part}` : ''}`;
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid wallet API response.'); return value as Record<string, unknown>; }
function chain(value: unknown): Chain { if (value !== 'arbitrum' && value !== 'ethereum') throw new Error('Unexpected wallet network.'); return value; }
function time(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
export function parseWallet(value: unknown): WalletSnapshot {
  const data = object(value);
  if (data.version !== 1 || data.network !== 'testnet' || data.location !== 'computer' || !time(data.fetchedAt) || typeof data.tokenNotice !== 'string' || !Array.isArray(data.balances) || data.balances.length !== 2) throw new Error('Invalid wallet snapshot.');
  const seen = new Set<Chain>();
  for (const raw of data.balances) {
    const item = object(raw), key = chain(item.chain);
    if (seen.has(key) || item.chainId !== CHAINS[key].id || item.name !== CHAINS[key].name || item.symbol !== 'ETH' || !isAddress(item.address) || typeof item.qr !== 'string' || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(item.qr) || item.qr.length > 40000 || typeof item.error !== 'string') throw new Error('Invalid wallet balance.');
    if (item.balance === null || item.balanceWei === null) { if (item.balance !== null || item.balanceWei !== null || !item.error) throw new Error('Missing balance cannot be shown as zero.'); }
    else if (typeof item.balance !== 'string' || typeof item.balanceWei !== 'string' || !/^\d+$/.test(item.balanceWei) || wei(item.balance) !== BigInt(item.balanceWei)) throw new Error('Invalid wallet amount.');
    seen.add(key);
  }
  return data as unknown as WalletSnapshot;
}
export function parseQuote(value: unknown): LiveQuote {
  const q = object(value), key = chain(q.chain);
  if (typeof q.id !== 'string' || !/^[\da-f-]{36}$/i.test(q.id) || q.chainId !== CHAINS[key].id || q.network !== CHAINS[key].name || q.symbol !== 'ETH' || !isAddress(q.from) || !isAddress(q.recipient) || !time(q.expiresAt) || typeof q.amount !== 'string' || typeof q.fee !== 'string' || typeof q.total !== 'string' || wei(q.amount) <= 0n || wei(q.fee) <= 0n || wei(q.fee) > 10n ** 16n || wei(q.total) !== wei(q.amount) + wei(q.fee)) throw new Error('Invalid transfer review. Nothing was submitted.');
  return q as unknown as LiveQuote;
}
export function parseTransaction(value: unknown): LiveTransaction {
  const item = object(value), key = chain(item.chain);
  if (typeof item.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(item.hash) || !['unknown', 'pending', 'confirmed', 'failed'].includes(String(item.status)) || item.explorerUrl !== `${CHAINS[key].explorer}/tx/${item.hash}` || item.amount !== undefined && (typeof item.amount !== 'string' || wei(item.amount) < 0n) || item.fee !== undefined && (typeof item.fee !== 'string' || wei(item.fee) < 0n)) throw new Error('Invalid transaction receipt.');
  return item as unknown as LiveTransaction;
}
export function parseHistory(value: unknown): LiveHistory {
  const data = object(value);
  if (data.version !== 1 || !time(data.fetchedAt) || typeof data.source !== 'string' || !Array.isArray(data.items) || data.items.length > 50 || !Array.isArray(data.errors) || !data.errors.every(item => typeof item === 'string')) throw new Error('Invalid activity response.');
  return { version: 1, fetchedAt: data.fetchedAt, source: data.source, items: data.items.map(parseTransaction), errors: data.errors as string[] };
}
export function createWalletClient(endpoint: string, transport: typeof fetch = fetch) {
  let connected: Promise<void> | null = null;
  async function request(route: string, body?: unknown) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Configure the local testnet wallet API on localhost.');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await transport(url.origin + route, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) connected = null; throw new Error(typeof data?.error === 'string' ? data.error : 'The wallet API is unavailable.'); }
      return data;
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError' && !/fetch|Network|network request|Failed to/i.test(error.message)) throw error;
      throw new Error(body && route.endsWith('/confirm') ? 'The submission response was lost. Check Activity before creating another transfer; the network may have received it.' : 'The local wallet API could not be reached. Check the server and connection.');
    } finally { clearTimeout(timer); }
  }
  async function connect() { if (!connected) connected = request('/api/wallet/session').then(data => { if (data.ready !== true || data.network !== 'testnet') throw new Error('Invalid wallet session.'); }).catch(error => { connected = null; throw error; }); await connected; }
  return {
    async wallet() { await connect(); return parseWallet(await request('/api/wallet')); },
    async history() { await connect(); return parseHistory(await request('/api/wallet/history')); },
    async quote(input: { chain: Chain; recipient: string; amount: string }) { await connect(); const q = parseQuote(await request('/api/wallet/quote', input)); if (q.chain !== input.chain || q.recipient.toLowerCase() !== input.recipient.toLowerCase() || wei(q.amount) !== wei(input.amount)) throw new Error('The review did not match your transfer.'); return q; },
    async confirm(q: LiveQuote) { await connect(); const tx = parseTransaction(await request('/api/wallet/confirm', { quoteId: q.id, approved: true })); if (tx.chain !== q.chain || tx.recipient?.toLowerCase() !== q.recipient.toLowerCase() || tx.from?.toLowerCase() !== q.from.toLowerCase() || tx.amount === undefined || wei(tx.amount) !== wei(q.amount) || tx.fee === undefined || wei(tx.fee) !== wei(q.fee)) throw new Error('Unexpected submission response. Check Activity before sending again.'); return tx; },
    async receipt(key: Chain, hash: string) { await connect(); const tx = parseTransaction(await request(`/api/wallet/receipt?chain=${key}&hash=${encodeURIComponent(hash)}`)); if (tx.chain !== key || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('Receipt did not match the transaction.'); return tx; },
  };
}
