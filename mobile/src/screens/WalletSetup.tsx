import React, { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, Label, Note, Screen } from '../components/ui';
import { colors as c } from '../theme';
// Extensionless on purpose: this is how Metro picks wallet-worklet.native.ts on a phone and
// wallet-worklet.ts (which refuses) on web. Naming the extension would force the web stub.
import { getKeystore, keystoreAvailable, keystoreUnavailableReason } from '../services/wallet-worklet';

/**
 * The fork a new user meets: make a wallet, or bring one in.
 *
 * Until this existed the app opened straight onto the wallet with no way to create or recover
 * one — FEATURE-AUDIT §1, the most serious gap in that document. A user who lost their phone
 * lost their money, permanently, with no support path.
 *
 * It gates the **live** wallet only. Demo mode still opens straight onto the wallet, so the
 * browser stays the quickest way to check a layout and none of the demo flow changes.
 */
export function WalletSetupScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const keystore = await getKeystore();
      await keystore.create();
      // The phrase is not passed through navigation. It is read back from the worklet on the
      // next screen, so it never sits in a route parameter, a deep link or the navigation
      // history — any of which would outlive the screen that shows it.
      router.replace({ pathname: '/recovery-phrase', params: { mode: 'setup' } });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The wallet could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return <Screen title="Set up your wallet" subtitle="Your keys stay on this phone">
    <Card>
      <Label size={18} weight="semibold">A wallet only you control</Label>
      <Note>Wally holds your keys on this phone and nowhere else. No account, no password, no email — which also means nobody can unlock it for you if you lose it.</Note>
    </Card>

    <Card>
      <Label size={16} weight="medium">New to this?</Label>
      <Note>We will create a wallet and show you twelve words. Those words are the only way back if you lose this phone, so you will be asked to write them down before you can send anything.</Note>
      <Button label={busy ? 'Creating…' : 'Create a new wallet'} onPress={() => { void create(); }} disabled={busy || !keystoreAvailable} />
    </Card>

    <Card>
      <Label size={16} weight="medium">Already have a wallet?</Label>
      <Note>If you have your twelve or twenty-four words from Wally or another wallet, you can bring it in here.</Note>
      <Button secondary label="I have a recovery phrase" onPress={() => router.push('/restore-wallet')} disabled={busy || !keystoreAvailable} />
    </Card>

    {!keystoreAvailable && <Card><Label weight="semibold">Not available here</Label><Note>{keystoreUnavailableReason()}</Note></Card>}
    {!!error && <Card><Label weight="semibold" color={c.ink}>The wallet was not created</Label><Note error>{error}</Note><Note>Nothing was saved and no funds are involved. You can try again.</Note></Card>}

    <View><Button secondary label="Not now" onPress={() => router.replace('/wallet')} /></View>
  </Screen>;
}
