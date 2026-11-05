import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
type Recipient = { id: string; name: string; address: string; network: 'Arbitrum' | 'Ethereum' };
type Preferences = { name: string; currency: string; saved: string[]; recipients: Recipient[] };
const defaults: Preferences = { name: 'Daniel', currency: 'USD', saved: ['BTC', 'ETH'], recipients: [
  { id: 'victor', name: 'Victor', address: '0x' + '1'.repeat(40), network: 'Arbitrum' },
  { id: 'emmy', name: 'Emmy', address: '0x' + '6'.repeat(40), network: 'Ethereum' },
  { id: 'daniel', name: 'Daniel', address: '0x' + '4'.repeat(40), network: 'Arbitrum' },
] };
const key = 'wally.frontend-preferences.v1';
const Context = createContext<{ preferences: Preferences; updatePreferences: (patch: Partial<Preferences>) => void; error: string } | null>(null);
export function PreferencesProvider({ children }: React.PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key).then(raw => {
      if (!alive || !raw) return;
      const parsed = JSON.parse(raw) as Preferences;
      if (typeof parsed.name !== 'string' || parsed.name.length > 40 || !['USD', 'NGN', 'EUR'].includes(parsed.currency) || !Array.isArray(parsed.saved) || !parsed.saved.every(symbol => ['BTC', 'ETH', 'SOL', 'USDT'].includes(symbol)) || !Array.isArray(parsed.recipients) || !parsed.recipients.every(recipient => typeof recipient.id === 'string' && typeof recipient.name === 'string' && /^0x[\da-fA-F]{40}$/.test(recipient.address) && ['Arbitrum', 'Ethereum'].includes(recipient.network))) throw new Error('Invalid preferences');
      setPreferences(parsed);
    }).catch(() => { if (alive) setError('Saved preferences could not be loaded.'); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    writes.current = writes.current.then(() => AsyncStorage.setItem(key, JSON.stringify(preferences))).catch(() => setError('Preferences could not be saved on this device.'));
  }, [preferences, ready]);
  return <Context value={{ preferences, updatePreferences: patch => setPreferences(previous => ({ ...previous, ...patch })), error }}>{children}</Context>;
}
export function usePreferences() { const value = useContext(Context); if (!value) throw new Error('Missing preferences provider'); return value; }
