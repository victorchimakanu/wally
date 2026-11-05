import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { currencyCode, fetchChart, fetchMarket, parseSavedChart, parseSavedMarket, type ChartSnapshot, type Currency, type MarketSnapshot } from '../services/market-api';

const TTL = 5 * 60 * 1000;
const Context = createContext<{ data: MarketSnapshot | null; currency: Currency; loading: boolean; stale: boolean; offline: boolean; error: string; refresh: () => void } | null>(null);
export function MarketProvider({ children }: React.PropsWithChildren) {
  const { preferences } = usePreferences();
  const { state } = useDemo();
  const [online, setOnline] = useState(() => Platform.OS !== 'web' || typeof navigator === 'undefined' || navigator.onLine);
  const currency = currencyCode(preferences.currency);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed); window.addEventListener('offline', changed);
    return () => { window.removeEventListener('online', changed); window.removeEventListener('offline', changed); };
  }, []);
  return <MarketSession currency={currency} offline={state.offline || !online}>{children}</MarketSession>;
}
function MarketSession({ currency, offline, children }: React.PropsWithChildren<{ currency: Currency; offline: boolean }>) {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [clock, setClock] = useState(Date.now);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const cached = useRef<MarketSnapshot | null>(null);
  const key = `wally.market.v1.${currency}`;
  const refresh = useCallback(async (force = false) => {
    if (offline || active.current || (!force && cached.current?.currency === currency && Date.now() - cached.current.fetchedAt < TTL)) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError('');
    try {
      const fresh = await fetchMarket(currency, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      cached.current = fresh; setData(fresh); setFailed(false); setClock(Date.now());
      try { await AsyncStorage.setItem(key, JSON.stringify(fresh)); } catch { if (alive.current) setError('Prices refreshed, but could not be saved for offline use.'); }
    } catch (failure) { if (alive.current && !controller.signal.aborted) { setFailed(true); setError(failure instanceof Error ? failure.message : 'Market data is unavailable.'); } }
    finally { if (active.current === controller) { active.current = null; if (alive.current) setLoading(false); } }
  }, [currency, key, offline]);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void AsyncStorage.getItem(key).then(raw => {
      if (cancelled || !raw) return;
      const saved = parseSavedMarket(JSON.parse(raw), currency);
      cached.current = saved; setData(saved);
    }).catch(() => {}).finally(() => { if (!cancelled) void refresh(); });
    const timer = setInterval(() => { setClock(Date.now()); void refresh(); }, TTL);
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    return () => { cancelled = true; alive.current = false; active.current?.abort(); active.current = null; clearInterval(timer); subscription.remove(); };
  }, [currency, key, refresh]);
  const visible = data?.currency === currency ? data : null;
  return <Context value={{ data: visible, currency, offline, loading, stale: offline || failed || !!visible && clock - visible.fetchedAt >= TTL, error, refresh: () => { void refresh(true); } }}>{children}</Context>;
}
export function useMarket() { const value = useContext(Context); if (!value) throw new Error('MarketProvider is missing'); return value; }

const charts = new Map<string, ChartSnapshot>();
export function useMarketChart(id: string, days: number) {
  const { currency, offline } = useMarket();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), TTL); return () => clearInterval(timer); }, []);
  const key = `wally.chart.v1.${id}.${currency}.${days}`;
  const [result, setResult] = useState<{ key: string; data: ChartSnapshot | null; error: string; done: boolean }>({ key: '', data: null, error: '', done: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      let cached = charts.get(key) ?? null;
      if (!cached) try { const raw = await AsyncStorage.getItem(key); if (raw) cached = parseSavedChart(JSON.parse(raw), id, currency, days); } catch {}
      if (controller.signal.aborted) return;
      if (cached) setResult({ key, data: cached, error: '', done: offline || Date.now() - cached.fetchedAt < TTL });
      if (offline || cached && Date.now() - cached.fetchedAt < TTL && attempt === 0) { setResult({ key, data: cached, error: offline && !cached ? 'This chart has not been saved offline yet.' : '', done: true }); return; }
      try { const data = await fetchChart(id, currency, days, controller.signal); if (controller.signal.aborted) return; charts.set(key, data); setResult({ key, data, error: '', done: true }); await AsyncStorage.setItem(key, JSON.stringify(data)).catch(() => {}); }
      catch (error) { if (!controller.signal.aborted) setResult({ key, data: cached, error: error instanceof Error ? error.message : 'Chart unavailable.', done: true }); }
    })();
    return () => controller.abort();
  }, [key, id, currency, days, offline, attempt]);
  return { data: result.key === key ? result.data : charts.get(key) ?? null, loading: result.key !== key || !result.done, error: result.key === key ? result.error : '', stale: offline || !!result.error || !!result.data && clock - result.data.fetchedAt >= TTL, refresh: () => setAttempt(value => value + 1) };
}
