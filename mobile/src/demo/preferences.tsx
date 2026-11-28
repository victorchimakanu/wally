import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { parsePreferences, droppedNotice, toStored, SAMPLE_RECIPIENTS, withoutSampleRecipients, type Preferences, type Recipient } from '../services/preferences-store';
import { liveWalletEnabled } from '../data/wallet';
export type { Preferences, Recipient };
/**
 * The samples are for the demo wallet and only the demo wallet.
 *
 * With a live wallet connected they are three unrecoverable burn addresses sitting in the
 * address book, reachable in two taps with the recipient prefilled. See SAMPLE_RECIPIENTS in
 * services/preferences-store.ts for why `addressTrust()` cannot catch that.
 */
const defaults: Preferences = {
  name: 'Daniel', currency: 'USD', saved: ['BTC', 'ETH'],
  recipients: liveWalletEnabled ? [] : [...SAMPLE_RECIPIENTS],
};
const key = 'wally.frontend-preferences.v1';
const Context = createContext<{ preferences: Preferences; updatePreferences: (patch: Partial<Preferences>) => void; resetPreferences: () => void; error: string } | null>(null);
export function PreferencesProvider({ children }: React.PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key).then(raw => {
      if (!alive || !raw) return;
      // Per field, not all-or-nothing. The old version validated the whole record in one
      // expression and threw, and this catch replaced every saved recipient with the samples.
      // One malformed address cost a user their entire address book.
      const { preferences: loaded, dropped } = parsePreferences(JSON.parse(raw), defaults);
      // Not just the defaults: a device that ran the demo first has the samples on disk, and
      // connecting a real wallet must not inherit them. Silent, because they were never the
      // user's entries and naming them would read as "we deleted your contacts".
      setPreferences(liveWalletEnabled ? { ...loaded, recipients: withoutSampleRecipients(loaded.recipients) } : loaded);
      const notice = droppedNotice(dropped);
      if (notice) setError(notice);
    }).catch(() => { if (alive) setError('Saved preferences could not be read on this device. Nothing was changed.'); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    writes.current = writes.current.then(() => AsyncStorage.setItem(key, JSON.stringify(toStored(preferences)))).catch(() => setError('Preferences could not be saved on this device.'));
  }, [preferences, ready]);
  return <Context value={{
    preferences,
    updatePreferences: patch => setPreferences(previous => ({ ...previous, ...patch })),
    /**
     * Forget the saved recipients, name and currency.
     *
     * Deleting the stored key is not enough on its own and this is the reason why: these
     * values live in React state as well, and the effect above rewrites them on the next
     * change. Clear storage without clearing memory and the address book is back the moment
     * the user touches anything — a deletion that undoes itself. Called by the reset flow
     * before it touches storage, so that whatever lands last is the defaults.
     */
    resetPreferences: () => setPreferences(defaults),
    error,
  }}>{children}</Context>;
}
export function usePreferences() { const value = useContext(Context); if (!value) throw new Error('Missing preferences provider'); return value; }
