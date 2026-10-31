import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { createWalletClient, parseWallet, type Chain, type LiveHistory, type LiveQuote, type LiveTransaction, type WalletSnapshot } from '../services/wallet-api';

const endpoint = process.env.EXPO_PUBLIC_WALLY_API_URL ?? '';
export const liveWalletEnabled = !!endpoint;
const client = endpoint ? createWalletClient(endpoint) : null;
const cacheKey = `wally.testnet.wallet.v1.${endpoint}`;
type WalletContext = { enabled: boolean; snapshot: WalletSnapshot | null; history: LiveHistory | null; loading: boolean; historyLoading: boolean; error: string; historyError: string; stale: boolean; offline: boolean; quote: LiveQuote | null; refresh: () => Promise<void>; refreshHistory: () => Promise<void>; prepare: (input: { chain: Chain; recipient: string; amount: string }) => Promise<void>; clearQuote: () => void; confirm: () => Promise<LiveTransaction>; receipt: (chain: Chain, hash: string) => Promise<LiveTransaction> };
const Context = createContext<WalletContext | null>(null);
export function WalletProvider({ children }: React.PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null), [history, setHistory] = useState<LiveHistory | null>(null);
  const [loading, setLoading] = useState(false), [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(''), [historyError, setHistoryError] = useState('');
  const [quote, setQuote] = useState<LiveQuote | null>(null), activeQuote = useRef<LiveQuote | null>(null);
  const [offline, setOffline] = useState(() => Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.onLine);
  const [saved, setSaved] = useState(true);
  const fetching = useRef(false), fetchingHistory = useRef(false), submitting = useRef(false), quoteGeneration = useRef(0);
  // The addresses the next history fetch should use. Set on every request; the in-flight
  // fetch re-reads it when it finishes, so a request made while one is running is honoured
  // rather than dropped. See refreshHistory.
  const wantedAddresses = useRef('');
  const alive = useRef(true), current = useRef<WalletSnapshot | null>(null), offlineNow = useRef(offline);
  const clearQuote = useCallback(() => { quoteGeneration.current++; activeQuote.current = null; setQuote(null); }, []);
  const refresh = useCallback(async () => {
    if (!client || fetching.current || offlineNow.current) return;
    fetching.current = true; setLoading(true); setError('');
    try {
      const data = await client.wallet(); if (!alive.current) return;
      if (current.current && current.current.balances.some(item => item.address !== data.balances.find(next => next.chain === item.chain)?.address)) { setHistory(null); clearQuote(); }
      current.current = data; setSnapshot(data); setSaved(false);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => { if (alive.current) setError('Balances refreshed but could not be saved offline.'); });
    } catch (failure) { if (alive.current) { setSaved(true); setError(failure instanceof Error ? failure.message : 'Wallet unavailable.'); } }
    finally { fetching.current = false; if (alive.current) setLoading(false); }
  }, [clearQuote]);
  const refreshHistory = useCallback(async () => {
    if (!client || offlineNow.current) return;
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
        const data = await client.history(JSON.parse(used) as Partial<Record<Chain, string>>);
        if (!alive.current) return;
        setHistory(data);
      }
    }
    catch (failure) { if (alive.current) setHistoryError(failure instanceof Error ? failure.message : 'Activity unavailable.'); }
    finally { fetchingHistory.current = false; if (alive.current) setHistoryLoading(false); }
  }, []);
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
    void (async () => { try { const raw = await AsyncStorage.getItem(cacheKey); if (raw && alive.current && !current.current) { const data = parseWallet(JSON.parse(raw)); current.current = data; setSnapshot(data); } } catch {} if (alive.current) await refresh(); })();
    const timer = setInterval(() => { void refresh(); }, 60000);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    const changed = () => { offlineNow.current = !navigator.onLine; setOffline(offlineNow.current); clearQuote(); if (!offlineNow.current) void refresh(); };
    if (Platform.OS === 'web') { window.addEventListener('online', changed); window.addEventListener('offline', changed); }
    return () => { alive.current = false; clearInterval(timer); subscription.remove(); if (Platform.OS === 'web') { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); } };
  }, [refresh, clearQuote]);
  const value: WalletContext = {
    enabled: liveWalletEnabled, snapshot, history, loading, historyLoading, error, historyError, stale: saved || offline || !!snapshot?.balances.some(item => item.error), offline, quote, refresh, refreshHistory, clearQuote,
    async prepare(input) {
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
      if (!client || offlineNow.current || !q || q.expiresAt <= Date.now()) throw new Error('Request a fresh review before confirming.');
      if (submitting.current) throw new Error('Submission is already in progress.');
      submitting.current = true; clearQuote();
      try { const tx = await client.confirm(q); void refresh(); void refreshHistory(); return tx; }
      catch (failure) { void refreshHistory(); throw failure; }
      finally { submitting.current = false; }
    },
    async receipt(chain, hash) { if (!client || offlineNow.current) throw new Error('Reconnect to check the actual network receipt.'); return client.receipt(chain, hash); },
  };
  return <Context value={value}>{children}</Context>;
}
export function useWallet() { const value = useContext(Context); if (!value) throw new Error('WalletProvider is missing'); return value; }
