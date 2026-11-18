import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { createWalletClient, fetchProxyHistory, parseWallet, type Chain, type LiveHistory, type LiveQuote, type LiveTransaction, type WalletSnapshot } from '../services/wallet-api';
import { asLiveHistory, hasMore, loadFirstPage, loadNextPage, withLocalSubmissions, type PageFetcher, type PagedHistory } from '../services/history-pager';
// Extensionless: Metro picks the native biometric path on a phone, the no-op on web.
import { requireUnlock } from '../services/unlock';
import { quoteExpired } from '../services/quote-clock';
import Constants from 'expo-constants';
import { checkSendGate } from '../services/send-gate';
import { backendOrigin, backendHeaders } from '../services/backend';
// Extensionless: Metro picks the native vault reader on a phone, the no-keystore stub on web.
import { currentCustody } from '../services/wallet-worklet';
import { custodyNotice, moneySource, type Custody } from '../services/custody';

const endpoint = process.env.EXPO_PUBLIC_WALLY_API_URL ?? '';
export const liveWalletEnabled = !!endpoint;
const client = endpoint ? createWalletClient(endpoint) : null;
const cacheKey = `wally.testnet.wallet.v1.${endpoint}`;
type WalletContext = { enabled: boolean; custody: Custody | null; blocked: string | null; snapshot: WalletSnapshot | null; history: LiveHistory | null; loading: boolean; historyLoading: boolean; error: string; historyError: string; stale: boolean; offline: boolean; quote: LiveQuote | null; refresh: () => Promise<void>; refreshHistory: () => Promise<void>; historyHasMore: boolean; historyLoadingMore: boolean; loadMoreHistory: () => Promise<void>; prepare: (input: { chain: Chain; recipient: string; amount: string; token?: string }) => Promise<void>; clearQuote: () => void; confirm: () => Promise<LiveTransaction>; receipt: (chain: Chain, hash: string) => Promise<LiveTransaction>; resolve: (chain: Chain, hash: string) => Promise<LiveTransaction> };
const Context = createContext<WalletContext | null>(null);
export function WalletProvider({ children }: React.PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null), [history, setHistory] = useState<LiveHistory | null>(null);
  const [loading, setLoading] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [error, setError] = useState(''), [historyError, setHistoryError] = useState('');
  const [quote, setQuote] = useState<LiveQuote | null>(null), activeQuote = useRef<LiveQuote | null>(null);
  const [offline, setOffline] = useState(() => Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.onLine);
  const [saved, setSaved] = useState(true);
  /**
   * Which wallet this build is allowed to show, decided before anything is fetched.
   *
   * Null until the vault has been read. `blocked` is the refusal: a wallet exists on this phone
   * and something else is configured to supply the money. Rather than quietly showing the other
   * wallet's balances and receive address — the address a user would fund, with a phrase that
   * cannot recover it — nothing is fetched and the screens say why.
   */
  const [custody, setCustody] = useState<Custody | null>(null);
  const allowed = useRef(false);
  const fetching = useRef(false), fetchingHistory = useRef(false), submitting = useRef(false), quoteGeneration = useRef(0);
  // The addresses the next history fetch should use. Set on every request; the in-flight
  // fetch re-reads it when it finishes, so a request made while one is running is honoured
  // rather than dropped. See refreshHistory.
  const wantedAddresses = useRef('');
  // Everything Activity has read so far, with a page cursor per chain. A ref rather than
  // state: `loadMoreHistory` must read the latest cursors at the moment it is pressed, and a
  // stale closure over state would re-request a page already held.
  const paged = useRef<PagedHistory | null>(null), loadingMore = useRef(false);
  /**
   * One page of one chain.
   *
   * Per chain is not a convenience. The route merges both chains into one fifty-item page, so
   * asking for both drops records that no later page returns — see `history-pager.ts`.
   */
  const pageFetcher = useCallback((addresses: Partial<Record<Chain, string>>): PageFetcher => (chain, page) => {
    const address = addresses[chain];
    if (!address) throw new Error('No wallet address is known yet.');
    return fetchProxyHistory({ [chain]: address }, fetch, { chain, page });
  }, []);
  const alive = useRef(true), current = useRef<WalletSnapshot | null>(null), offlineNow = useRef(offline);
  const clearQuote = useCallback(() => { quoteGeneration.current++; activeQuote.current = null; setQuote(null); }, []);
  const refresh = useCallback(async () => {
    if (!client || !allowed.current || fetching.current || offlineNow.current) return;
    fetching.current = true; setLoading(true); setError('');
    try {
      const data = await client.wallet(); if (!alive.current) return;
      if (current.current && current.current.balances.some(item => item.address !== data.balances.find(next => next.chain === item.chain)?.address)) { setHistory(null); paged.current = null; clearQuote(); }
      current.current = data; setSnapshot(data); setSaved(false);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => { if (alive.current) setError('Balances refreshed but could not be saved offline.'); });
    } catch (failure) { if (alive.current) { setSaved(true); setError(failure instanceof Error ? failure.message : 'Wallet unavailable.'); } }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, [clearQuote]);
  const refreshHistory = useCallback(async () => {
    if (!client || !allowed.current || offlineNow.current) return;
    // Per chain, not one address for both: Arbitrum's smart-account address need not match
    // the Ethereum EOA.
    //
    // Before 31 Oct 2026 this read the addresses once and gave up if the snapshot had not
    // loaded, which on a cold start meant Activity fetched with none — returning only this
    // device's own transfers, with the wallet server's "history is unavailable" error still
    // attached, and no retry, because the effect that calls this has a stable dependency.
    // The result was an error message that was no longer true, appearing intermittently.
    // So record what the fetch SHOULD use, and re-run while that keeps changing.
    wantedAddresses.current = JSON.stringify(
      Object.fromEntries((current.current?.balances ?? []).map(item => [item.chain, item.address])),
    );
    if (fetchingHistory.current) return; // the running fetch will pick up the new addresses
    fetchingHistory.current = true; setHistoryLoading(true); setHistoryError('');
    try {
      let used = '';
      while (used !== wantedAddresses.current) {
        used = wantedAddresses.current;
        const addresses = JSON.parse(used) as Partial<Record<Chain, string>>;
        const local = await client.localHistory();
        if (!alive.current) return;
        const chains = (Object.keys(addresses) as Chain[]).filter(chain => !!addresses[chain]);
        let next: LiveHistory;
        if (!backendOrigin() || !chains.length) {
          // No proxy configured, or no addresses known yet. The loopback list is the whole
          // list and it does not page, so drop the cursors: a Load more that cannot load
          // anything is worse than no button at all.
          paged.current = null; next = local;
        } else {
          const first = withLocalSubmissions(await loadFirstPage(chains, pageFetcher(addresses)), local);
          paged.current = first; next = asLiveHistory(first);
        }
        if (!alive.current) return;
        setHistory(next);
      }
    }
    catch (failure) { if (alive.current) setHistoryError(failure instanceof Error ? failure.message : 'Activity unavailable.'); }
    finally { fetchingHistory.current = false; if (alive.current) setHistoryLoading(false); }
  }, [pageFetcher]);
  /**
   * Read the next page of every chain that still has one, and append.
   *
   * Appending rather than replacing is the whole point: the reader keeps what they were
   * looking at and gets more below it. A chain that fails keeps its cursor, so pressing again
   * retries it instead of writing off the rest of its history — see `history-pager.ts`.
   */
  const loadMoreHistory = useCallback(async () => {
    const base = paged.current;
    if (!base || !hasMore(base) || loadingMore.current || !allowed.current || offlineNow.current) return;
    const addresses = JSON.parse(wantedAddresses.current || '{}') as Partial<Record<Chain, string>>;
    loadingMore.current = true; setHistoryLoadingMore(true); setHistoryError('');
    try {
      const next = await loadNextPage(base, pageFetcher(addresses));
      if (!alive.current) return;
      paged.current = next; setHistory(asLiveHistory(next));
    }
    catch (failure) { if (alive.current) setHistoryError(failure instanceof Error ? failure.message : 'Older activity could not be loaded.'); }
    finally { loadingMore.current = false; if (alive.current) setHistoryLoadingMore(false); }
  }, [pageFetcher]);
  /**
   * Re-fetch history the moment the wallet's addresses first appear, or change.
   *
   * Activity asks for history when it mounts, which on a cold start is before the snapshot
   * has loaded. That first fetch is still worth making — it shows this device's own
   * transfers immediately — but it cannot include indexed history, so it has to be followed
   * by one that can. Keyed on the addresses themselves, so it also covers the wallet being
   * replaced, and does nothing until there is something to ask with.
   */
  const addressKey = (snapshot?.balances ?? []).map(item => `${item.chain}:${item.address}`).sort().join('|');
  useEffect(() => {
    if (!addressKey) return;
    void refreshHistory();
  }, [addressKey, refreshHistory]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      // Decide whose money this is BEFORE reading the cache or the network. The cached
      // snapshot is the dev server's addresses, so restoring it in a refused split would put
      // another wallet's receive address on screen from the first frame.
      let decided: Custody;
      try { decided = await currentCustody(); }
      // A vault that will not answer is not a reason to show the other wallet. Treat it as a
      // wallet being present, which is the safe direction: refuse, and say so.
      catch { decided = { kind: 'split', permitted: false }; }
      if (!alive.current) return;
      allowed.current = moneySource(decided) !== 'blocked';
      setCustody(decided);
      if (!allowed.current) return;
      try { const raw = await AsyncStorage.getItem(cacheKey); if (raw && alive.current && !current.current) { const data = parseWallet(JSON.parse(raw)); current.current = data; setSnapshot(data); } } catch {}
      if (alive.current) await refresh();
    })();
    const timer = setInterval(() => { void refresh(); }, 60000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    const changed = () => { offlineNow.current = !navigator.onLine; setOffline(offlineNow.current); clearQuote(); if (!offlineNow.current) void refresh(); };
    if (Platform.OS === 'web') { window.addEventListener('online', changed); window.addEventListener('offline', changed); }
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); if (Platform.OS === 'web') { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); } };
  }, [refresh, clearQuote]);
  const value: WalletContext = {
    // `enabled` now means "configured AND permitted". A refused split reports false, so every
    // screen that branches on it falls back to demo rather than showing the other wallet.
    enabled: liveWalletEnabled && !!custody && moneySource(custody) !== 'blocked',
    custody,
    blocked: custody && moneySource(custody) === 'blocked' ? custodyNotice(custody) : null,
    snapshot, history, loading, historyLoading, error, historyError, stale: saved || offline || !!snapshot?.balances.some(item => item.error), offline, quote, refresh, refreshHistory, clearQuote,
    // Derived, not stored. `asLiveHistory` already stamps hasMore onto the list it hands
    // over, and a second copy in state is a second thing that can disagree with it.
    historyHasMore: history?.hasMore === true, historyLoadingMore, loadMoreHistory,
    async prepare(input) {
      if (!allowed.current) throw new Error('This build cannot open the wallet stored on this phone. Nothing can be sent until it can.');
      if (!client || offlineNow.current) throw new Error('Reconnect to the local wallet API for a fresh review.');
      clearQuote(); const generation = quoteGeneration.current;
      const next = await client.quote(input);
      if (generation !== quoteGeneration.current || offlineNow.current) throw new Error('The transfer changed. Request a fresh review.');
      const address = current.current?.balances.find(item => item.chain === input.chain)?.address;
      if (!address || next.from.toLowerCase() !== address.toLowerCase()) throw new Error('The wallet changed. Refresh your balance before reviewing.');
      activeQuote.current = next; setQuote(next);
    },
    async confirm() {
      const q = activeQuote.current;
      // q.deadline, not q.expiresAt: the latter is the server's clock and comparing it with
      // this phone's made a quote look expired on any handset running fast. quote-clock.ts.
      if (!client || offlineNow.current || !q || quoteExpired(q.deadline)) throw new Error('Request a fresh review before confirming.');
      if (submitting.current) throw new Error('Submission is already in progress.');

      // The last gate before anything irreversible, and the only one in the app: every live
      // spend comes through here. Asked on every send regardless of how recently the phone was
      // unlocked — a previous unlock is not consent for a later transfer.
      //
      // Deliberately before `submitting` is set and before the quote is cleared, so a
      // cancelled prompt leaves the review exactly as it was and the user can simply confirm
      // again. Clearing first would make a mis-tap cost them a fresh quote.
      //
      // Where the phone has no screen lock, or on web, this passes straight through: there is
      // no protection to perform, and refusing would leave such a user unable to send at all.
      const unlocked = await requireUnlock('send', `${q.amount} ${q.symbol}`);
      if (!unlocked.ok) throw new Error(unlocked.message);

      // The remote stop, asked here and not earlier. `send-gate.ts` and the backend's
      // `/v1/status` have both existed since 5 November with nothing between them: the
      // repository looked like it had a kill switch and the app had no way to be stopped.
      //
      // After the unlock rather than before, so a paused service costs a user one biometric
      // prompt instead of silently refusing before they have confirmed they meant it — and
      // immediately before the irreversible call, so the answer is as fresh as it can be.
      //
      // It fails OPEN by construction (see checkSendGate): a backend that is down, slow or
      // unreachable must never stop someone spending their own money. This stops Wally when
      // Wally is broken; it is not a permission to transact.
      const gate = await checkSendGate({
        origin: backendOrigin(),
        appVersion: Constants.expoConfig?.version ?? '0.0.0',
        headers: backendHeaders(),
      });
      if (!gate.allowed) throw new Error(gate.reason);

      submitting.current = true; clearQuote();
      try { const tx = await client.confirm(q); void refresh(); void refreshHistory(); return tx; }
      catch (failure) { void refreshHistory(); throw failure; }
      finally { submitting.current = false; }
    },
    async receipt(chain, hash) { if (!client || offlineNow.current) throw new Error('Reconnect to check the actual network receipt.'); return client.receipt(chain, hash); },
    /**
     * Mark a stranded transfer as never arrived. The server refuses this for anything it can
     * still judge against the chain, so this cannot declare a slow transfer dead.
     */
    async resolve(chain, hash) {
      if (!client || offlineNow.current) throw new Error('Reconnect before resolving a transfer.');
      const tx = await client.resolve(chain, hash);
      void refreshHistory();
      return tx;
    },
  };
  return <Context value={value}>{children}</Context>;
}
export function useWallet() { const value = useContext(Context); if (!value) throw new Error('WalletProvider is missing'); return value; }
