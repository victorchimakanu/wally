import React, { useState } from 'react';
import { router } from 'expo-router';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { SettingsToggle as Toggle } from '../components/SettingsToggle';
import { getKeystore } from '../services/wallet-worklet';

/**
 * Remove this wallet from this phone.
 *
 * Irreversible, and the recovery phrase is the only way back — the vault cannot know whether
 * the user has it written down, so this screen asks. The confirmation is a deliberate toggle
 * rather than a second button: a destructive action one mis-tap away from a list of settings
 * is how people lose money by accident.
 *
 * Two things this is honest about. It removes the wallet from *this device* — the funds stay
 * on the chain and the phrase still controls them. And it is also the route Google Play
 * requires for in-app data deletion (FEATURE-AUDIT §11), which is the other reason it exists.
 */
export function ResetWalletScreen() {
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function forget() {
    setBusy(true);
    setError('');
    try {
      const keystore = await getKeystore();
      await keystore.forget();
      router.replace('/wallet-setup');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The wallet could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return <Screen title="Remove this wallet" subtitle="This cannot be undone">
    <Card>
      <Pill tone="warning">Your recovery phrase is the only way back</Pill>
      <Note>This deletes the keys stored on this phone. Your money stays on the blockchain, and your twelve words still control it — but without those words, nothing can reach it again. Not us, not anybody.</Note>
    </Card>

    <Card>
      <Label size={16} weight="medium">Before you do this</Label>
      <Note>Check that you can read your recovery phrase off paper right now. Not that you remember writing it down — that you can see it.</Note>
    </Card>

    <Toggle
      label="I have my recovery phrase"
      subtitle="And I have checked I can read it"
      value={understood}
      onChange={setUnderstood}
    />

    {!!error && <Card><Label weight="semibold">The wallet was not removed</Label><Note error>{error}</Note><Note>Nothing has changed.</Note></Card>}

    <Button label={busy ? 'Removing…' : 'Remove wallet from this phone'} onPress={() => { void forget(); }} disabled={!understood || busy} />
    <Button secondary label="Keep my wallet" onPress={() => router.back()} />
  </Screen>;
}
