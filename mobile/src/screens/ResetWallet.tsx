import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { SettingsToggle as Toggle } from '../components/SettingsToggle';
import { getKeystore } from '../services/wallet-worklet';
import { describeStoredData } from '../services/app-data';
import { clearDeviceData } from '../services/app-data-device';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { colors as c } from '../theme';

/**
 * Remove this wallet from this phone.
 *
 * Irreversible, and the recovery phrase is the only way back — the vault cannot know whether
 * the user has it written down, so this screen asks. The confirmation is a deliberate toggle
 * rather than a second button: a destructive action one mis-tap away from a list of settings
 * is how people lose money by accident.
 *
 * Two things this is honest about. It removes the wallet from *this device* — the funds stay
 * on the chain and the phrase still controls them. And it is the route Google Play's data
 * safety declaration points at for data deletion (FEATURE-AUDIT §11). Worth noting that the
 * in-app *account* deletion requirement is for apps that let people create an account, which
 * Wally deliberately does not; this screen exists because the promise on the button should be
 * true, not because the store forces it.
 *
 * It did not used to be true. The button called `forget()`, which deleted the two keystore
 * entries — and left the chat history, the saved recipients, a cache of the wallet's own
 * addresses and the app-lock setting sitting in ordinary app storage. Someone selling the
 * handset was told this could not be undone and left all of that behind. What goes now is
 * everything in `STORED_DATA` marked personal, and the list below is generated from the same
 * table that performs the deletion, so the screen cannot promise something different from
 * what runs.
 *
 * Saved prices and charts are deliberately kept. They are public data, identical for everyone,
 * and deleting them protects nobody at the cost of a slow first screen.
 */
export function ResetWalletScreen() {
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [kept, setKept] = useState<{ label: string; reason: string }[]>([]);
  const [walletGone, setWalletGone] = useState(false);
  const [dataGone, setDataGone] = useState(false);
  const { clearHistory } = useDemo();
  const { resetPreferences } = usePreferences();

  const removes = describeStoredData(['keys', 'personal']);

  async function forget() {
    setBusy(true);
    setError('');
    setKept([]);
    setDataGone(false);
    try {
      // In-memory first, storage second. Both providers hold their state in React as well as
      // on disk and rewrite it on the next change, so clearing storage alone would see the
      // chat history and the address book return the moment the user touched anything. Wiping
      // memory first means that whatever lands last is the defaults.
      //
      // `clearHistory()` and not `reset()`: reset restores the two sample conversations the
      // app ships with, and conversations reappearing immediately after a deletion reads as
      // the deletion having failed. A genuinely fresh install shows them; a wipe should not.
      await clearHistory();
      resetPreferences();

      const result = await clearDeviceData(['personal']);
      setDataGone(result.removed.length > 0);

      // The keys go even when some of that failed. Blocking wallet removal on a refused
      // deletion elsewhere would be a lockout — the user came here to remove the wallet, and
      // the leftover data stays independently deletable from Settings afterwards.
      const keystore = await getKeystore();
      await keystore.forget();
      setWalletGone(true);

      if (result.kept.length) { setKept(result.kept); return; }  // Report instead of leaving.
      router.replace('/wallet-setup');
    } catch (problem) {
      // "Nothing has changed" was the old message here and it would now be a lie: a throw
      // from the keystore arrives after the saved data has already gone. Say which it was.
      setError(problem instanceof Error ? problem.message : 'The wallet could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  // The wallet is gone but something would not delete. Saying "done" here would be a lie, and
  // navigating away would hide it, so the screen stays and names what is left.
  if (walletGone && kept.length) return <Screen title="Wallet removed" subtitle="Some data is still here" back={false}>
    <Card>
      <Pill tone="success">THE WALLET IS OFF THIS PHONE</Pill>
      <Note>Your keys are deleted. Your recovery phrase is the only way back to that money.</Note>
    </Card>
    <Card>
      <Label size={16} weight="medium">This phone would not delete</Label>
      {kept.map(item => <View key={item.label} style={{ gap: 2 }}>
        <Label size={14}>{item.label}</Label>
        <Note error>{item.reason}</Note>
      </View>)}
      <Note>Try again from Settings. Nothing here can reach your money — the keys are already gone.</Note>
    </Card>
    <Button label="Set up a wallet" onPress={() => router.replace('/wallet-setup')} />
  </Screen>;

  return <Screen title="Remove this wallet" subtitle="This cannot be undone">
    <Card>
      <Pill tone="warning">Your recovery phrase is the only way back</Pill>
      <Note>This deletes the keys stored on this phone. Your money stays on the blockchain, and your twelve words still control it — but without those words, nothing can reach it again. Not us, not anybody.</Note>
    </Card>

    <Card>
      <Label size={12} weight="semibold" color={c.orange}>WHAT THIS DELETES</Label>
      {removes.map(line => <Label key={line} size={14}>· {line}</Label>)}
      <Note>Saved prices and charts are kept. They are public market data and say nothing about you.</Note>
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

    {!!error && <Card>
      <Label weight="semibold">The wallet was not removed</Label>
      <Note error>{error}</Note>
      <Note>{dataGone
        ? 'Your keys are still on this phone and your money is untouched. Your chats and saved recipients were deleted before this failed, and they cannot be brought back.'
        : 'Nothing has changed.'}</Note>
    </Card>}

    <Button label={busy ? 'Removing…' : 'Remove wallet from this phone'} onPress={() => { void forget(); }} disabled={!understood || busy} />
    <Button secondary label="Keep my wallet" onPress={() => router.back()} />
  </Screen>;
}
