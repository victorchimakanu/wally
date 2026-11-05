import { fetch as expoFetch } from 'expo/fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { appendChatMessages, draftStatus, originIsCurrent, initialState, settle, submit, scriptedReply, validateDraft, type DemoState, type Draft, type DraftOrigin, type Quote, type Message } from './model';
import { chatReply, quickWalletReply, requestChat, requestIntent } from '../services/qvac';
import { getPhoneRuntime, phoneAvailable } from '../services/phone-adapter';
import type { PhoneMetrics, PhoneRuntime, PhoneStatus } from '../services/phone-runtime';
import type { PhoneModel, PhoneBackend } from '../services/phone-models';
import { liveWalletEnabled, useWallet } from '../data/wallet';
import { liveIntentReply, quickLiveReply } from '../services/live-wallet-chat';
import { quickMarketReply } from '../services/market-chat';

const STORAGE_KEY = 'wally.frontend-demo.v1';
// This HTTP transport is for development only. Public Expo variables must never contain secrets.
const endpoint = __DEV__ ? process.env.EXPO_PUBLIC_QVAC_URL ?? '' : '';
const model = process.env.EXPO_PUBLIC_QVAC_MODEL ?? 'wally-llm';
const hasAi = phoneAvailable || !!endpoint;
let sequence = 0;
const id = () => `${Date.now()}-${++sequence}`;
type AiState = { mode: 'qvac' | 'scripted'; location: 'phone' | 'computer' | 'scripted'; status: 'unchecked' | 'working' | 'ready' | 'error'; error: string; busyChatId: string | null; preview: string };
type DemoContextValue = {
  state: DemoState; ready: boolean; storageError: string; quote: Quote | null;
  ai: AiState; checkAi: () => void; cancelAi: () => void;
  phone: PhoneStatus | null; phoneMetrics: PhoneMetrics | null; getRuntime: () => Promise<PhoneRuntime>;
  loadPhone: (model: PhoneModel, backend: PhoneBackend) => void; releasePhone: () => void;
  draft: Draft; setDraft: (draft: Draft) => void;
  update: (patch: Partial<Pick<DemoState, 'welcomed' | 'offline' | 'aiPaused' | 'failNext' | 'quoteSeconds'>>) => void;
  newChat: () => string; sendMessage: (chatId: string, text: string) => boolean;
  discardDraft: (chatId: string, messageId: string) => void;
  updateChatDraft: (origin: DraftOrigin, draft: Draft) => string | null;
  prepare: (draft: Draft, origin?: DraftOrigin) => string | null; cancel: () => void;
  confirm: () => { id?: string; error?: string }; reset: () => void;
};
const Context = createContext<DemoContextValue | null>(null);

/** Stores only fictional preview data. Never place wallet secrets here. */
export function DemoProvider({ children }: React.PropsWithChildren) {
  const wallet = useWallet();
  const [state, setState] = useState<DemoState>(initialState);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const activeQuote = useRef<Quote | null>(null);
  const [draft, setDraft] = useState<Draft>({ amount: '', recipient: '' });
  const writes = useRef(Promise.resolve());
  const [ai, setAi] = useState<AiState>({ mode: hasAi ? 'qvac' : 'scripted', location: phoneAvailable ? 'phone' : endpoint ? 'computer' : 'scripted', status: 'unchecked', error: '', busyChatId: null, preview: '' });
  const [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [phoneMetrics, setPhoneMetrics] = useState<PhoneMetrics | null>(null);
  const nativeRuntime = useRef<PhoneRuntime | null>(null);
  async function getRuntime() {
    const runtime = await getPhoneRuntime(setPhone); nativeRuntime.current = runtime; return runtime;
  }
  const activeRequest = useRef<{ controller: AbortController; chatId?: string } | null>(null);

  function commit(next: DemoState) { current.current = next; setState(next); }
  function append(chatId: string, messages: Message[], title?: string) {
    if (messages.some(message => message.draft) && activeQuote.current?.origin?.chatId === chatId) { activeQuote.current = null; setQuote(null); }
    commit({ ...current.current, chats: current.current.chats.map(chat => chat.id === chatId ? {
      ...chat, title: chat.messages.length ? chat.title : title ?? chat.title,
      updatedAt: Date.now(), messages: appendChatMessages(chat.messages, messages),
    } : chat) });
  }
  function cancelAi() {
    const pending = activeRequest.current;
    if (!pending) return;
    activeRequest.current = null; pending.controller.abort();
    if (pending.chatId) append(pending.chatId, [{ id: id(), role: 'assistant', text: 'AI request cancelled. Nothing was submitted.', tool: { kind: 'stopped' } }]);
    setAi(previous => ({ ...previous, status: 'unchecked', busyChatId: null, preview: '', error: '' }));
  }
  async function runAi(text: string, chatId?: string, history: Message[] = []) {
    if (activeRequest.current || current.current.aiPaused || (current.current.offline && !phoneAvailable)) return;
    const pending = { controller: new AbortController(), chatId };
    activeRequest.current = pending;
    setAi(previous => ({ ...previous, status: 'working', error: '', busyChatId: chatId ?? null, preview: '' }));
    try {
      let intent;
      if (phoneAvailable) {
        const result = await (await getRuntime()).request({ text, history, intentOnly: !chatId, signal: pending.controller.signal, walletMode: liveWalletEnabled ? 'testnet' : undefined,
          onReply(preview) { if (activeRequest.current === pending) setAi(previous => ({ ...previous, preview })); } });
        intent = result.intent;
        if (activeRequest.current === pending) setPhoneMetrics(result.metrics);
      } else intent = chatId ? await requestChat(endpoint, model, text, history, pending.controller.signal, {
        fetch: expoFetch,
        walletMode: liveWalletEnabled ? 'testnet' : undefined,
        onReply(preview) { if (activeRequest.current === pending) setAi(previous => ({ ...previous, preview })); },
      }) : await requestIntent(endpoint, model, text, pending.controller.signal);
      if (activeRequest.current !== pending) return;
      if (!chatId && intent.intent !== 'balance') throw new Error('QVAC responded, but the wallet-intent check failed.');
      if (chatId) append(chatId, [{ id: id(), role: 'assistant', ...(liveWalletEnabled ? liveIntentReply(intent) : chatReply(intent, text, current.current)) }]);
      setAi(previous => ({ ...previous, status: 'ready', error: '', busyChatId: null, preview: '' }));
    } catch (error) {
      if (activeRequest.current !== pending) return;
      const detail = phoneAvailable && error instanceof Error ? error.message : error instanceof Error && error.name === 'AbortError' ? 'The local AI request timed out. Check QVAC and retry.' : 'Wally could not reach or validate the local model. Check that QVAC is running, then try again.';
      if (chatId) append(chatId, [{ id: id(), role: 'assistant', text: `${detail} You can still use manual wallet controls. Nothing was submitted.`, tool: { kind: /timed out|timeout/i.test(detail) ? 'timeout' : 'unavailable' } }]);
      setAi(previous => ({ ...previous, status: 'error', error: detail, busyChatId: null, preview: '' }));
    } finally {
      if (activeRequest.current === pending) activeRequest.current = null;
    }
  }
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (!phoneAvailable) return;
      if (next !== 'active') cancelAi();
      void nativeRuntime.current?.setBackground(next !== 'active').catch(() => {});
    });
    return () => { subscription.remove(); activeRequest.current?.controller.abort(); activeRequest.current = null; void nativeRuntime.current?.release().catch(() => {}); };
    // The handler uses current state and pending requests through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!alive || !raw) return;
      const saved = JSON.parse(raw) as DemoState;
      if (saved.version !== 1 || !Number.isSafeInteger(saved.balance) || saved.balance < 0 ||
          !Array.isArray(saved.chats) || !Array.isArray(saved.transactions) ||
          !saved.chats.every(c => typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages)) ||
          !saved.transactions.every(t => typeof t.id === 'string' && ['pending', 'confirmed', 'failed'].includes(t.status) && !validateDraft(t, Number.MAX_SAFE_INTEGER))) {
        throw new Error('Invalid demo data');
      }
      commit(settle({ ...initialState(), ...saved }, Date.now()));
    }).catch(() => { if (alive) setStorageError('Saved demo data could not be loaded. This session starts fresh.'); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const serialized = JSON.stringify(state);
    writes.current = writes.current.then(() => AsyncStorage.setItem(STORAGE_KEY, serialized))
      .catch(() => setStorageError('Demo changes could not be saved on this device.'));
  }, [state, ready]);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = settle(current.current, Date.now());
      if (next !== current.current) commit(next);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const value: DemoContextValue = {
    state, ready, storageError, quote, draft, setDraft, ai, cancelAi, phone, phoneMetrics, getRuntime,
    loadPhone(selectedModel, backend) {
      if (activeRequest.current || current.current.aiPaused || current.current.offline) return;
      const pending = { controller: new AbortController() }; activeRequest.current = pending;
      setAi(previous => ({ ...previous, status: 'working', error: '' }));
      void (async () => {
        try {
          const runtime = await getRuntime(); await runtime.configure(selectedModel, backend);
          await runtime.prepare(pending.controller.signal);
          if (activeRequest.current === pending) setAi(previous => ({ ...previous, status: 'unchecked' }));
        } catch (error) {
          if (activeRequest.current === pending) setAi(previous => ({ ...previous, status: 'error', error: error instanceof Error ? error.message : 'Phone model setup failed.' }));
        } finally { if (activeRequest.current === pending) activeRequest.current = null; }
      })();
    },
    releasePhone() { cancelAi(); void nativeRuntime.current?.release().catch(error => setAi(previous => ({ ...previous, status: 'error', error: String(error) }))); setAi(previous => ({ ...previous, status: 'unchecked' })); },
    checkAi() { if (hasAi) void runAi('What is my balance?'); },
    update(patch) {
      if (patch.aiPaused || patch.offline) cancelAi();
      if (patch.aiPaused) void nativeRuntime.current?.release().catch(() => {});
      // Connectivity changes invalidate approval; reconnecting always needs a fresh quote.
      if (patch.offline !== undefined && patch.offline !== current.current.offline) {
        wallet.clearQuote();
        activeQuote.current = null; setQuote(null);
      }
      commit({ ...current.current, ...patch });
    },
    newChat() {
      const chatId = id();
      commit({ ...current.current, chats: [{ id: chatId, title: 'New conversation', updatedAt: Date.now(), messages: [] }, ...current.current.chats] });
      return chatId;
    },
    sendMessage(chatId, text) {
      const clean = text.trim().slice(0, 1000);
      if (!clean || activeRequest.current || !current.current.chats.some(c => c.id === chatId)) return false;
      // Read-only card replies need no inference, so they still answer while the assistant is paused.
      const direct = quickMarketReply(clean) ?? (liveWalletEnabled ? quickLiveReply(clean) : quickWalletReply(clean, current.current));
      if (current.current.aiPaused && !direct) return false;
      const history = current.current.chats.find(chat => chat.id === chatId)?.messages ?? [];
      append(chatId, [{ id: id(), role: 'user', text: clean }], clean.slice(0, 48));
      if (direct) { append(chatId, [{ id: id(), role: 'assistant', ...direct }]); return true; }
      if (hasAi && (!current.current.offline || phoneAvailable)) {
        void runAi(clean, chatId, history); return true;
      }
      const reply = liveWalletEnabled ? { text: 'The local assistant is unavailable. You can use wallet tools to fetch balances, receive, check Activity, or manually review a testnet ETH transfer. Nothing has been submitted.' } : scriptedReply(clean, current.current);
      append(chatId, [{ id: id(), role: 'assistant', ...reply, text: hasAi ? `Offline scripted preview: ${reply.text}` : reply.text }]);
      return true;
    },
    discardDraft(chatId, messageId) {
      const message = current.current.chats.find(chat => chat.id === chatId)?.messages.find(item => item.id === messageId);
      if (!message?.draft || draftStatus(message) !== 'active') return;
      const discarded = message.draft;
      if (activeQuote.current?.origin?.chatId === chatId && activeQuote.current.origin.messageId === messageId) { activeQuote.current = null; setQuote(null); }
      if (draft.recipient === discarded.recipient && draft.amount === discarded.amount) setDraft({ recipient: '', amount: '' });
      commit({ ...current.current, chats: current.current.chats.map(chat => chat.id === chatId ? { ...chat, messages: chat.messages.map(item => item.id === messageId ? { ...item, draftCancelled: true, draftState: 'cancelled' as const } : item) } : chat) });
    },
    updateChatDraft(origin, nextDraft) {
      const message = current.current.chats.find(chat => chat.id === origin.chatId)?.messages.find(item => item.id === origin.messageId);
      if (!message?.draft || draftStatus(message) !== 'active') return 'This draft is no longer current. Open the latest draft.';
      const error = validateDraft(nextDraft, current.current.balance);
      if (error) return error;
      setDraft(nextDraft);
      append(origin.chatId, [{ id: id(), role: 'assistant', text: 'I’ve updated your draft. Review the new details before confirming.', draft: nextDraft }]);
      return null;
    },
    prepare(nextDraft, origin) {
      if (liveWalletEnabled) return 'This is an old demo draft. Use Send to review a real testnet ETH transfer. USDt is not connected.';
      if (origin && !originIsCurrent(current.current, origin, nextDraft)) return 'This draft is no longer current. Open the latest draft.';
      activeQuote.current = null; setQuote(null);
      setDraft(nextDraft);
      if (current.current.offline) return 'Reconnect to get a fresh demo quote. Your draft is preserved.';
      const error = validateDraft(nextDraft, current.current.balance);
      if (error) return error;
      const nextQuote = { ...nextDraft, id: id(), expiresAt: Date.now() + current.current.quoteSeconds * 1000, ...(origin ? { origin } : {}) };
      activeQuote.current = nextQuote; setQuote(nextQuote);
      return null;
    },
    cancel() { activeQuote.current = null; setQuote(null); },
    confirm() {
      if (liveWalletEnabled) return { error: 'Demo transfers are disabled while the testnet wallet is connected. Use Send for a real network review.' };
      const q = activeQuote.current;
      if (!q) return { error: 'Request a fresh quote before confirming.' };
      if (q.origin && !originIsCurrent(current.current, q.origin, q)) return { error: 'This draft changed. Review the latest draft before confirming.' };
      const result = submit(current.current, q, Date.now());
      if (result.error) return { error: result.error };
      activeQuote.current = null; setQuote(null);
      const submitted = q.origin ? { ...result.state, chats: result.state.chats.map(chat => chat.id === q.origin!.chatId ? { ...chat, messages: chat.messages.map(message => message.id === q.origin!.messageId ? { ...message, draftState: 'submitted' as const, transactionId: q.id } : message) } : chat) } : result.state;
      commit(submitted);
      return { id: q.id };
    },
    reset() { cancelAi(); activeQuote.current = null; setQuote(null); setDraft({ amount: '', recipient: '' }); setStorageError(''); commit(initialState()); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw new Error('DemoProvider is missing');
  return value;
}





