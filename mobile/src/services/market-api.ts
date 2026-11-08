import { backendHeaders, backendOrigin } from './backend.ts';
export const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'tether', symbol: 'USDT', name: 'Tether' },
] as const;
export type Currency = 'USD' | 'NGN' | 'EUR';
export type MarketAsset = { id: string; symbol: string; name: string; currency: Currency; price: number | null; change: number | null; cap: number | null; volume: number | null; supply: number | null; maximum: number | null; updatedAt: string | null };
export type MarketSnapshot = { version: 1; source: 'CoinGecko'; currency: Currency; fetchedAt: number; assets: MarketAsset[] };
export type ChartSnapshot = { version: 1; source: 'CoinGecko'; currency: Currency; id: string; days: number; fetchedAt: number; points: [number, number][] };
/**
 * Market data goes through the Wally backend proxy when one is configured, so the provider
 * key stays on the server and every phone shares one cached, rate-limited origin.
 * The URL rules live in ./backend.ts, which chain history uses too.
 *
 * Unset EXPO_PUBLIC_WALLY_PROXY_URL and this falls back to calling CoinGecko directly,
 * exactly as before.
 */
export { resolveProxy } from './backend.ts';
const proxy = backendOrigin();
const base = proxy ? `${proxy}/v1` : 'https://api.coingecko.com/api/v3';

/** The shared key, when the backend requires one. See ./backend.ts for what it is and is not. */
function proxyHeaders(): Record<string, string> {
  return backendHeaders(proxy);
}

/**
 * Which upstream market data is actually coming from.
 *
 * The fallback to CoinGecko is deliberate — prices keep working when the backend is down —
 * but that makes a misconfigured proxy invisible. Settings shows this so the configured
 * path and the real one can be compared without reading server logs.
 */
export function marketSource(): { mode: 'proxy' | 'direct'; label: string; url: string } {
  return proxy
    ? { mode: 'proxy', label: 'Wally backend', url: proxy }
    : { mode: 'direct', label: 'CoinGecko (direct)', url: 'https://api.coingecko.com' };
}

/** The proxy wraps provider payloads as { fetchedAt, fresh, data }; CoinGecko returns them bare. */
type Envelope = { fetchedAt?: unknown; fresh?: unknown; data?: unknown };
function unwrap(raw: unknown): { payload: unknown; fetchedAt: number } {
  if (!proxy) return { payload: raw, fetchedAt: Date.now() };
  const body = raw as Envelope;
  if (!body || typeof body !== 'object' || !('data' in body)) throw new Error('The market service returned an unexpected response.');
  // A stale response carries the time it was actually fetched, so "Saved" stays truthful.
  const at = typeof body.fetchedAt === 'number' && Number.isSafeInteger(body.fetchedAt) && body.fetchedAt > 0 ? body.fetchedAt : Date.now();
  return { payload: body.data, fetchedAt: Math.min(at, Date.now()) };
}
const nullable = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const positive = (value: unknown): number | null => { const n = nullable(value); return n !== null && n >= 0 ? n : null; };
export function currencyCode(value: string): Currency { return value === 'NGN' || value === 'EUR' ? value : 'USD'; }
export function parseSavedMarket(raw: unknown, currency: Currency, now = Date.now()): MarketSnapshot {
  const data = raw as MarketSnapshot;
  if (!data || data.version !== 1 || data.source !== 'CoinGecko' || data.currency !== currency || !Number.isSafeInteger(data.fetchedAt) || data.fetchedAt <= 0 || data.fetchedAt > now || !Array.isArray(data.assets) || !data.assets.length || data.assets.length > COINS.length || new Set(data.assets.map(item => item?.id)).size !== data.assets.length || !data.assets.every(item => item && COINS.some(coin => coin.id === item.id && coin.symbol === item.symbol && coin.name === item.name) && item.currency === currency && [item.price, item.cap, item.volume, item.supply, item.maximum].every(value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0) && (item.change === null || typeof item.change === 'number' && Number.isFinite(item.change)) && (item.updatedAt === null || typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))))) throw new Error('Invalid saved market data.');
  return data;
}
export function parseSavedChart(raw: unknown, id: string, currency: Currency, days: number, now = Date.now()): ChartSnapshot {
  const data = raw as ChartSnapshot;
  if (!data || data.version !== 1 || data.source !== 'CoinGecko' || data.currency !== currency || data.id !== id || data.days !== days || !Number.isSafeInteger(data.fetchedAt) || data.fetchedAt <= 0 || data.fetchedAt > now) throw new Error('Invalid saved chart.');
  return parseChart({ prices: data.points }, id, currency, days, data.fetchedAt);
}
export function parseMarket(raw: unknown, currency: Currency, now = Date.now()): MarketSnapshot {
  if (!Array.isArray(raw) || raw.length > 100) throw new Error('The market provider returned invalid data.');
  const assets = COINS.flatMap(coin => {
    const item = raw.find(value => value && typeof value === 'object' && value.id === coin.id);
    if (!item) return [];
    return [{ ...coin, currency, price: positive(item.current_price), change: nullable(item.price_change_percentage_24h), cap: positive(item.market_cap), volume: positive(item.total_volume), supply: positive(item.circulating_supply), maximum: positive(item.max_supply), updatedAt: typeof item.last_updated === 'string' && Number.isFinite(Date.parse(item.last_updated)) ? item.last_updated : null }];
  });
  if (!assets.length || !assets.some(asset => asset.price !== null)) throw new Error('The market provider returned no usable prices.');
  return { version: 1, source: 'CoinGecko', currency, fetchedAt: now, assets };
}
export function parseChart(raw: unknown, id: string, currency: Currency, days: number, now = Date.now()): ChartSnapshot {
  const values = raw && typeof raw === 'object' ? (raw as { prices?: unknown }).prices : null;
  if (!Array.isArray(values) || values.length > 10000) throw new Error('The chart provider returned invalid data.');
  const points: [number, number][] = [];
  for (const value of values) {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || !Number.isFinite(value[0]) || value[0] <= 0 || typeof value[1] !== 'number' || !Number.isFinite(value[1]) || value[1] < 0 || (points.length && value[0] <= points.at(-1)![0])) throw new Error('The chart provider returned invalid price points.');
    points.push([value[0], value[1]]);
  }
  if (points.length < 2) throw new Error('There are not enough points to display this chart.');
  return { version: 1, source: 'CoinGecko', currency, id, days, fetchedAt: now, points };
}
async function get(path: string, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(base + path, { signal: controller.signal, headers: { Accept: 'application/json', ...proxyHeaders() } });
    if (!response.ok) throw new Error(response.status === 429 ? 'Market refresh is temporarily rate limited. Try again later.' : response.status === 401 || response.status === 403 ? 'The market provider requires an API plan for this request.' : `The market provider is unavailable (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof Error && /rate limited|API plan|unavailable/.test(error.message)) throw error;
    throw new Error('Market data could not be refreshed. Check your connection and retry.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export async function fetchMarket(currency: Currency, signal?: AbortSignal): Promise<MarketSnapshot> {
  const path = proxy
    ? `/market?currency=${currency.toLowerCase()}`
    : `/coins/markets?vs_currency=${currency.toLowerCase()}&ids=${COINS.map(coin => coin.id).join(',')}&sparkline=false`;
  const { payload, fetchedAt } = unwrap(await get(path, signal));
  return parseMarket(payload, currency, fetchedAt);
}
export async function fetchChart(id: string, currency: Currency, days: number, signal?: AbortSignal): Promise<ChartSnapshot> {
  if (!COINS.some(coin => coin.id === id) || ![1, 7, 30, 365].includes(days)) throw new Error('Unsupported chart request.');
  const path = proxy
    ? `/market/chart?id=${id}&days=${days}&currency=${currency.toLowerCase()}`
    : `/coins/${id}/market_chart?vs_currency=${currency.toLowerCase()}&days=${days}`;
  const { payload, fetchedAt } = unwrap(await get(path, signal));
  return parseChart(payload, id, currency, days, fetchedAt);
}
export function formatPrice(amount: number | null, currency: Currency = 'USD', compact = false): string {
  return amount === null ? 'Unavailable' : amount.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 2, ...(compact ? { notation: 'compact' as const } : {}) });
}
export function formatChange(change: number | null): string { return change === null ? 'Unavailable' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`; }
export function chartPoints(points: [number, number][], width: number, height: number, limit = 60) {
  if (points.length < 2 || width <= 0 || height <= 0) return [];
  const sampled = points.filter((_, i) => i === points.length - 1 || i % Math.max(1, Math.ceil(points.length / limit)) === 0);
  const low = Math.min(...sampled.map(point => point[1])), high = Math.max(...sampled.map(point => point[1]));
  const start = sampled[0][0], duration = sampled.at(-1)![0] - start;
  return sampled.map(([time, value]) => ({ x: (time - start) / duration * width, y: high === low ? height / 2 : height - (value - low) / (high - low) * height }));
}
