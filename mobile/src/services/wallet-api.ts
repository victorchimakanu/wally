// DEVELOPMENT CLIENT for the loopback wallet API (scripts/wallet-api-server.mjs),
// which holds the seed on the developer's computer. Production signing happens
// on-device in a WDK Bare worklet — see docs/ADR-001-key-custody.md.
//
// Activity is the one read that can already come from the real backend: history needs no key,
// only an address. When EXPO_PUBLIC_WALLY_PROXY_URL is set, it is read from there and merged
// with this device's own submissions. Everything else still goes to the loopback server.
import { backendHeaders, backendOrigin } from './backend.ts';
// Safe despite the apparent cycle: tokens.ts imports only the `Chain` *type* from this file,
// which is erased at runtime, so nothing is half-initialised at load.
import { tokensFor } from './tokens.ts';
import { plausibleQuoteSpan, quoteDeadline } from './quote-clock.ts';
export type Chain = 'arbitrum' | 'ethereum';
export const CHAINS = { arbitrum: { name: 'Arbitrum Sepolia', id: 421614, explorer: 'https://sepolia.arbiscan.io' }, ethereum: { name: 'Ethereum Sepolia', id: 11155111, explorer: 'https://sepolia.etherscan.io' } } as const;
export type WalletBalance = { chain: Chain; name: string; chainId: number; symbol: 'ETH'; address: string; qr: string; balance: string | null; balanceWei: string | null; error: string };
export type WalletSnapshot = { version: 1; network: 'testnet'; location: 'computer'; fetchedAt: number; balances: WalletBalance[]; tokenNotice: string };
export type LiveQuote = { id: string; chain: Chain; chainId: number; network: string; symbol: 'ETH'; from: string; recipient: string; amount: string; fee: string; total: string;
  /** The server's own clock. Kept for the record; never compared against this phone's. */
  expiresAt: number;
  /** How long the server says the quote is good for. */
  expiresInMs: number;
  /**
   * The local deadline, on this phone's monotonic clock, fixed when the quote arrived. This is
   * the only value the app compares against — see quote-clock.ts for why.
   */
  deadline: number };
/**
 * `superseded` means the transfer can never land: the account's nonce was spent by a different
 * transaction, so this one is dead and the money never moved. It is deliberately not `failed` —
 * a failed transaction ran on the chain and cost a fee, and only `superseded` carries the
 * guarantee that nothing happened at all. See FEATURE-AUDIT §28.3.
 */
export type LiveTransaction = { hash: string; chain: Chain; status: 'unknown' | 'pending' | 'confirmed' | 'failed' | 'superseded'; explorerUrl: string; from?: string; recipient?: string; amount?: string; fee?: string;
  /**
   * What `amount` is denominated in. Absent means the chain's native coin, which is how every
   * record read before USDt existed — so absence must keep meaning ETH rather than becoming an
   * error. `fee` is always native, whatever this says.
   */
  symbol?: string;
  submittedAt?: number; blockNumber?: number | null; checkedAt?: number };
/**
 * `page` and `hasMore` are optional because the loopback dev server does not send them — it
 * serves one list and has no pages. Activity ignores them; the export needs them, because
 * stopping at the first page would make a tax record that is quietly missing transfers.
 */
export type LiveHistory = { version: 1; fetchedAt: number; source: string; items: LiveTransaction[]; errors: string[]; page?: number; hasMore?: boolean };
export function isAddress(value: unknown): value is string { return typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value); }
/**
 * Accept a comma as a decimal separator, which most of the world and much of Nigeria uses.
 *
 * The rule is chosen for its failure direction, not its cleverness. `1,250` is genuinely
 * ambiguous — 1250 under thousands grouping, 1.250 under a decimal comma — and the two
 * readings differ by a factor of a thousand. Reading it as a decimal means a user who meant
 * 1250 sends 1.25: wrong, annoying, recoverable. Reading it as thousands means a user who
 * meant 1.250 sends 1250: wrong, and their money is gone.
 *
 * So a lone comma is always a decimal point, and anything more ambiguous than that — two
 * commas, or a comma and a period together — is refused rather than guessed at.
 */
export function normaliseAmount(value: string): string {
  if (typeof value !== 'string') return value;
  const commas = (value.match(/,/g) ?? []).length;
  if (commas === 0) return value;
  if (commas > 1 || value.includes('.')) return value; // ambiguous; let the test below refuse it
  return value.replace(',', '.');
}

/**
 * Turn what someone typed into the integer the chain actually moves.
 *
 * **`decimals` is data, not a constant, and getting it wrong is the worst bug this app could
 * have.** ETH has 18; USDt has 6. Feeding a USDt amount through the 18-decimal path would send
 * a million million times too much, and it would do so silently, because both numbers are valid
 * integers. So there is exactly one implementation and the caller must name the token's
 * decimals; `wei()` below is the native-ETH convenience that passes 18.
 *
 * The fractional limit follows `decimals`: a token with 6 cannot express a seventh place, and
 * silently truncating it would mean sending a different amount from the one on screen.
 */
export function toBaseUnits(value: string, decimals: number, unit = 'ETH'): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error('A token must declare a whole number of decimals.');
  }
  const text = normaliseAmount(value);
  // Integer part capped at 13 digits as before: beyond that is not an amount a person typed.
  //
  // Built conditionally, not eagerly: at decimals 0 the interpolated form is `\d{1,0}`, which
  // is an invalid quantifier and throws when the RegExp is constructed — even if the branch
  // that uses it is never taken. A test for a zero-decimal token found that.
  const shape = decimals === 0
    ? /^(?:0|[1-9]\d{0,12})$/
    : new RegExp(`^(?:0|[1-9]\\d{0,12})(?:\\.\\d{1,${decimals}})?$`);
  if (!shape.test(text)) {
    // Names the unit, because "up to 6 decimals" is confusing advice to someone who thinks
    // they are entering ETH. Phrased to avoid an article, so no symbol needs a special case.
    throw new Error(
      decimals === 0
        ? `Enter a whole number of ${unit}.`
        : `Enter an amount in ${unit} with up to ${decimals} decimals.`,
    );
  }
  const [whole, part = ''] = text.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(part.padEnd(decimals, '0') || '0');
}

/**
 * The largest whole part a *send* may carry.
 *
 * `toBaseUnits` is deliberately permissive because it also reads amounts off the chain, where a
 * spam transfer on a testnet can be enormous and the alternative to displaying it is blanking
 * the whole Activity list. An amount a person is typing is a different question, and bounding
 * both with one number means either refusing real history or accepting a send the wallet server
 * will reject.
 *
 * Four digits, which is the bound `ethUnits()` in mobile/scripts/wallet-api-core.mjs applies.
 * Before this existed the app validated a typed amount with the permissive parser, so `50000`
 * passed here and was refused by the server a round trip later — with a message about decimal
 * places, which was not the problem. A test compares the two parsers' verdicts across a corpus
 * so they cannot drift apart again.
 */
export const MAX_SEND_WHOLE_DIGITS = 4;

/**
 * Parse an amount somebody typed into a send field.
 *
 * Refuses zero as well as the unparseable, because a send of nothing is not a send and the
 * wallet server refuses it too — agreeing here means the message arrives under the user's
 * finger rather than after a round trip.
 */
export function parseSendAmount(value: string, decimals = 18, unit = 'ETH'): bigint {
  const units = toBaseUnits(value, decimals, unit);
  if (units <= 0n) throw new Error('Enter an amount greater than zero.');
  // No leading-zero stripping: toBaseUnits has already refused anything but a bare `0` or a
  // leading 1-9, so the whole part here is already in its shortest form.
  const whole = normaliseAmount(value).split('.')[0] ?? '';
  if (whole.length > MAX_SEND_WHOLE_DIGITS) {
    const limit = (10 ** MAX_SEND_WHOLE_DIGITS - 1).toLocaleString('en-US');
    throw new Error(`That is more than this wallet will send at once. The most is ${limit} ${unit}.`);
  }
  return units;
}

/** Native ETH: 18 decimals. A thin name over `toBaseUnits`, not a second implementation. */
export function wei(value: string): bigint {
  return toBaseUnits(value, 18, 'ETH');
}

/**
 * The most that can be sent while still leaving enough for the network fee.
 *
 * A user cannot send their whole balance — gas has to come out of it — and without this they
 * type the full number, get "not enough to cover the amount and network fee", and reasonably
 * read that as a bug. Returns 0n when the balance will not cover a fee at all.
 *
 * `bufferPercent` guards against the gas price rising between this estimate and the send.
 * Erring high costs the user a little dust left behind; erring low costs them a failed
 * transaction, so the default leans high.
 */
export function maxSendable(balanceWei: bigint, gasPriceWei: bigint, gasLimit = 21000n, bufferPercent = 20n): bigint {
  if (balanceWei <= 0n || gasPriceWei <= 0n || gasLimit <= 0n) return 0n;
  const fee = gasLimit * gasPriceWei;
  const reserve = fee + (fee * bufferPercent) / 100n;
  return balanceWei > reserve ? balanceWei - reserve : 0n;
}
/** Wei as ETH for display, cut (never rounded up) to `decimals` places; dust shows as "<0.000001". */
/**
 * The inverse: an integer from the chain, as a person should read it.
 *
 * `decimals` is the token's; `show` is how many places to display, which is a presentation
 * choice and not the same number. A non-zero amount that rounds to nothing displays as
 * `<0.000001` rather than `0`, because telling someone they hold zero when they do not is worse
 * than an awkward string.
 */
export function formatUnits(value: bigint, decimals: number, show = 6): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const places = Math.min(show, decimals);
  const part = decimals === 0
    ? ''
    : (value % scale).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  if (whole === 0n && !part && value > 0n) {
    return places > 0 ? `<0.${'0'.repeat(places - 1)}1` : '<1';
  }
  return `${whole.toLocaleString('en-US')}${part ? `.${part}` : ''}`;
}

/** Native ETH. Same single implementation. */
export function formatEth(value: bigint, decimals = 6): string {
  return formatUnits(value, 18, decimals);
}
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid wallet API response.'); return value as Record<string, unknown>; }
function chain(value: unknown): Chain { if (value !== 'arbitrum' && value !== 'ethereum') throw new Error('Unexpected wallet network.'); return value; }
function time(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
/**
 * Validate a wallet snapshot, now that a chain can carry more than its native coin.
 *
 * Two things changed and both matter:
 *
 * **One entry per chain became one per chain *and asset*.** The count is no longer fixed at
 * two — it is the two native coins plus however many tokens are pinned — so it is derived
 * rather than asserted, and the duplicate check keys on both.
 *
 * **The amount cross-check now uses the asset's own decimals.** `balanceWei` is the raw
 * integer and `balance` the displayed string, and requiring that one converts to the other is
 * what catches a server and an app disagreeing about a token's decimals. Checked with 18 for a
 * 6-decimal token it would pass for no value, or fail for the wrong reason. The field keeps its
 * name for compatibility with the dev wallet server, but for a token it holds base units, not
 * wei.
 */
export function parseWallet(value: unknown): WalletSnapshot {
  const data = object(value);
  const chains = Object.keys(CHAINS) as Chain[];
  const expected = chains.length + chains.reduce((total, key) => total + tokensFor(key).length, 0);
  if (data.version !== 1 || data.network !== 'testnet' || data.location !== 'computer' || !time(data.fetchedAt) || typeof data.tokenNotice !== 'string' || !Array.isArray(data.balances) || data.balances.length !== expected) throw new Error('Invalid wallet snapshot.');
  const seen = new Set<string>();
  for (const raw of data.balances) {
    const item = object(raw), key = chain(item.chain);
    // The native coin, or a token pinned for this chain. Anything else is refused rather than
    // displayed: an unknown asset has unknown decimals, and there is no safe way to show it.
    const symbol = typeof item.symbol === 'string' ? item.symbol : '';
    const token = symbol === 'ETH' ? null : tokensFor(key).find(entry => entry.symbol === symbol) ?? null;
    const decimals = symbol === 'ETH' ? 18 : token?.decimals;
    const slot = `${key}:${symbol}`;
    if (decimals === undefined || seen.has(slot) || item.chainId !== CHAINS[key].id || item.name !== CHAINS[key].name || !isAddress(item.address) || typeof item.qr !== 'string' || !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(item.qr) || item.qr.length > 40000 || typeof item.error !== 'string') throw new Error('Invalid wallet balance.');
    if (item.balance === null || item.balanceWei === null) { if (item.balance !== null || item.balanceWei !== null || !item.error) throw new Error('Missing balance cannot be shown as zero.'); }
    else if (typeof item.balance !== 'string' || typeof item.balanceWei !== 'string' || !/^\d+$/.test(item.balanceWei) || toBaseUnits(item.balance, decimals, symbol) !== BigInt(item.balanceWei)) throw new Error('Invalid wallet amount.');
    seen.add(slot);
  }
  return data as unknown as WalletSnapshot;
}
export function parseQuote(value: unknown): LiveQuote {
  const q = object(value), key = chain(q.chain);
  // How long the quote is good for, as the server declares it. Required: comparing the
  // server's `expiresAt` against this phone's clock is exactly the bug quote-clock.ts exists
  // to remove, so a response without a usable duration is refused rather than silently falling
  // back to that comparison.
  if (!plausibleQuoteSpan(q.expiresInMs)) throw new Error('The review did not say how long it is valid for.');
  if (typeof q.id !== 'string' || !/^[\da-f-]{36}$/i.test(q.id) || q.chainId !== CHAINS[key].id || q.network !== CHAINS[key].name || q.symbol !== 'ETH' || !isAddress(q.from) || !isAddress(q.recipient) || !time(q.expiresAt) || typeof q.amount !== 'string' || typeof q.fee !== 'string' || typeof q.total !== 'string' || wei(q.amount) <= 0n || wei(q.fee) <= 0n || wei(q.fee) > 10n ** 16n || wei(q.total) !== wei(q.amount) + wei(q.fee)) throw new Error('Invalid transfer review. Nothing was submitted.');
  // The local deadline is fixed here, at the moment the quote arrived. Deriving it later would
  // silently extend the quote by however long the delay was.
  return { ...q, deadline: quoteDeadline(q.expiresInMs as number) } as unknown as LiveQuote;
}
export function parseTransaction(value: unknown): LiveTransaction {
  const item = object(value), key = chain(item.chain);
  // A short, conservative symbol or nothing. An arbitrary string here would reach the screen
  // next to an amount, which is the one place a made-up label could mislead about money.
  if (item.symbol !== undefined && (typeof item.symbol !== 'string' || !/^[A-Za-z0-9]{1,12}$/.test(item.symbol))) throw new Error('Invalid transaction receipt.');
  if (typeof item.hash !== 'string' || !/^0x[\da-f]{64}$/i.test(item.hash) || !['unknown', 'pending', 'confirmed', 'failed', 'superseded'].includes(String(item.status)) || item.explorerUrl !== `${CHAINS[key].explorer}/tx/${item.hash}` || item.amount !== undefined && (typeof item.amount !== 'string' || wei(item.amount) < 0n) || item.fee !== undefined && (typeof item.fee !== 'string' || wei(item.fee) < 0n)) throw new Error('Invalid transaction receipt.');
  return item as unknown as LiveTransaction;
}
export function parseHistory(value: unknown): LiveHistory {
  const data = object(value);
  if (data.version !== 1 || !time(data.fetchedAt) || typeof data.source !== 'string' || !Array.isArray(data.items) || data.items.length > 50 || !Array.isArray(data.errors) || !data.errors.every(item => typeof item === 'string')) throw new Error('Invalid activity response.');
  if (data.page !== undefined && (typeof data.page !== 'number' || !Number.isInteger(data.page) || data.page < 1)) throw new Error('Invalid activity response.');
  if (data.hasMore !== undefined && typeof data.hasMore !== 'boolean') throw new Error('Invalid activity response.');
  return {
    version: 1, fetchedAt: data.fetchedAt, source: data.source,
    items: data.items.map(parseTransaction), errors: data.errors as string[],
    ...(data.page === undefined ? {} : { page: data.page as number }),
    ...(data.hasMore === undefined ? {} : { hasMore: data.hasMore as boolean }),
  };
}
/**
 * Where Activity is actually read from.
 *
 * The fallback to the loopback server is deliberate, but it makes a misconfigured proxy
 * invisible, so Settings shows this the way it already shows the market source.
 */
export function historySource(): { mode: 'proxy' | 'local'; label: string; url: string } {
  const origin = backendOrigin();
  return origin
    ? { mode: 'proxy', label: 'Wally backend', url: origin }
    : { mode: 'local', label: 'Local wallet server', url: 'http://127.0.0.1' };
}

/**
 * Read history for these addresses from the backend.
 *
 * Addresses are passed per chain rather than as one value: they need not match. Arbitrum uses
 * an ERC-4337 smart account whose address comes from the account factory, not from the key,
 * so it differs from the Ethereum EOA. The loopback dev server happens to use an EOA on both,
 * which hides this — hence the explicit per-chain parameters.
 */
export type HistoryPageOptions = {
  /**
   * Ask for one chain rather than both.
   *
   * This is not a filter for convenience — it is the only way to page without losing records.
   * The route fetches a page from each requested chain, merges them, sorts by time and slices
   * the result back down to fifty. With both chains asked for, up to fifty of the hundred
   * fetched are dropped, and page 2 fetches *the provider's* page 2 from each chain — so the
   * ones dropped from page 1 are not in page 2 either. They are unreachable. Asking for one
   * chain makes the merge a no-op and the slice harmless, so its pages are lossless.
   */
  chain?: Chain;
  /** 1-based. The backend refuses anything past its own maximum. */
  page?: number;
};

export async function fetchProxyHistory(
  addresses: Partial<Record<Chain, string>>,
  transport: typeof fetch = fetch,
  options: HistoryPageOptions = {},
): Promise<LiveHistory> {
  const origin = backendOrigin();
  if (!origin) throw new Error('No Wally backend is configured.');

  const query = new URLSearchParams();
  for (const [chain, address] of Object.entries(addresses)) {
    // Never put an unvalidated value in the URL; these come from a parsed wallet snapshot.
    if (isAddress(address)) query.set(`address.${chain}`, address);
  }
  if (![...query.keys()].length) throw new Error('No wallet address is known yet.');
  if (options.chain) query.set('chain', options.chain);
  if (options.page !== undefined) query.set('page', String(options.page));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await transport(`${origin}/v1/history?${query.toString()}`, {
      headers: { Accept: 'application/json', ...backendHeaders(origin) },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // The backend already phrases these for a person to read; prefer its wording to ours.
      const detail = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Activity is unavailable (${response.status}).`;
      throw new Error(detail);
    }
    return parseHistory(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Activity took too long to load. Try again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Combine indexed history with this device's own submissions.
 *
 * The backend cannot see a transaction a phone submitted but never got a receipt for, so a
 * just-sent transfer would vanish from Activity if the indexed list simply replaced the local
 * one. Indexed records win on a duplicate, because the indexer is authoritative about whether
 * something confirmed; a local record only ever knows what this device last checked.
 *
 * `local.errors` is dropped: those describe the loopback server's own indexer attempt, which
 * is no longer what Activity is built from, so repeating them would say something untrue.
 */
export function mergeHistory(remote: LiveHistory, local: LiveHistory): LiveHistory {
  const seen = new Set(remote.items.map(item => `${item.chain}:${item.hash.toLowerCase()}`));
  const items = [...remote.items];
  for (const item of local.items) {
    const id = `${item.chain}:${item.hash.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push(item);
  }
  return {
    version: 1,
    fetchedAt: remote.fetchedAt,
    source: `${remote.source} and this device's submissions`,
    // parseHistory refuses more than 50, so the cap is a contract and not a preference.
    items: items.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0)).slice(0, 50),
    errors: remote.errors,
  };
}

/**
 * Address the wallet API by the same hostname the page was opened with.
 *
 * The session cookie is `SameSite=Strict`, which is right for a server holding a seed. But
 * browsers treat `localhost` and `127.0.0.1` as different sites, so opening the app on one
 * while the API is configured as the other means the cookie is never stored: the handshake
 * succeeds, every call after it arrives unauthenticated, and the app reports "Connect to the
 * local wallet API first" while the server is in fact perfectly healthy. Measured 31 Oct 2026
 * — `localhost:8082` failed and `127.0.0.1:8082` worked, against the same running server.
 *
 * So on web, follow the page. Only the two loopback spellings are ever swapped between, and
 * both are already what `request()` accepts, so this cannot redirect the wallet API anywhere
 * new. Native builds have no `location` and are returned unchanged, which keeps the Android
 * emulator's 10.0.2.2 working.
 */
export function sameSiteEndpoint(raw: string, pageHost = globalThis.location?.hostname): string {
  const LOOPBACK = ['127.0.0.1', 'localhost'];
  if (!raw || typeof pageHost !== 'string' || !LOOPBACK.includes(pageHost)) return raw;
  try {
    const url = new URL(raw);
    if (!LOOPBACK.includes(url.hostname) || url.hostname === pageHost) return raw;
    url.hostname = pageHost;
    return url.origin;
  } catch {
    return raw;
  }
}

export function createWalletClient(rawEndpoint: string, transport: typeof fetch = fetch) {
  const endpoint = sameSiteEndpoint(rawEndpoint);
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
    /**
     * Activity. With a backend configured and addresses known, the backend is the source of
     * indexed history and the loopback server contributes only this device's submissions.
     * A backend failure is not fatal: the local list is returned with the reason appended.
     */
    async history(addresses?: Partial<Record<Chain, string>>) {
      await connect();
      const local = parseHistory(await request('/api/wallet/history'));
      if (!backendOrigin() || !addresses || !Object.keys(addresses).length) return local;
      try {
        return mergeHistory(await fetchProxyHistory(addresses, transport), local);
      } catch (failure) {
        const reason = failure instanceof Error ? failure.message : 'Activity could not be read from the Wally backend.';
        return { ...local, errors: [...local.errors, reason] };
      }
    },
    async quote(input: { chain: Chain; recipient: string; amount: string }) { await connect(); const q = parseQuote(await request('/api/wallet/quote', input)); if (q.chain !== input.chain || q.recipient.toLowerCase() !== input.recipient.toLowerCase() || wei(q.amount) !== wei(input.amount)) throw new Error('The review did not match your transfer.'); return q; },
    async confirm(q: LiveQuote) { await connect(); const tx = parseTransaction(await request('/api/wallet/confirm', { quoteId: q.id, approved: true })); if (tx.chain !== q.chain || tx.recipient?.toLowerCase() !== q.recipient.toLowerCase() || tx.from?.toLowerCase() !== q.from.toLowerCase() || tx.amount === undefined || wei(tx.amount) !== wei(q.amount) || tx.fee === undefined || wei(tx.fee) !== wei(q.fee)) throw new Error('Unexpected submission response. Check Activity before sending again.'); return tx; },
    /**
     * Mark a stranded transfer as never arrived, for the records the chain cannot settle.
     *
     * The server refuses this for any transfer it can still judge against the chain, so a
     * merely-slow transfer cannot be declared dead from here — that refusal is the thing
     * stopping this from becoming a way to send the same money twice.
     */
    async resolve(key: Chain, hash: string) {
      await connect();
      const tx = parseTransaction(await request('/api/wallet/resolve', { chain: key, hash }));
      if (tx.chain !== key || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('That response did not match the transfer.');
      return tx;
    },
    async receipt(key: Chain, hash: string) { await connect(); const tx = parseTransaction(await request(`/api/wallet/receipt?chain=${key}&hash=${encodeURIComponent(hash)}`)); if (tx.chain !== key || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error('Receipt did not match the transaction.'); return tx; },
  };
}
