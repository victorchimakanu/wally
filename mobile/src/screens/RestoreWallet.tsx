import React, { useState } from 'react';
import { router } from 'expo-router';
import { TextInput, View } from 'react-native';
import { Button, Card, Label, Note, Screen, shared } from '../components/ui';
import { phraseShape } from '../services/recovery';
import { getKeystore, keystoreAvailable, keystoreUnavailableReason } from '../services/wallet-worklet';
import { useScreenPrivacy } from '../services/screen-privacy';
import { colors as c, fonts } from '../theme';

/**
 * Bring an existing wallet in from its recovery phrase.
 *
 * Screen capture is blocked here too: the phrase is on screen while it is being typed, and a
 * screenshot of a half-typed phrase is as bad as one of a whole phrase.
 *
 * The shape of the phrase is checked locally before the worklet is woken, purely so the error
 * can name the problem — "that is 11 words" is actionable, and the worklet's answer for the
 * same input is an invalid-seed error that does not say which part is wrong. The checksum is
 * still the worklet's job.
 */
export function RestoreWalletScreen() {
  useScreenPrivacy('wally.restore-wallet');

  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const shape = phraseShape(text);
  const count = shape.words.length;

  async function restore() {
    setBusy(true);
    setError('');
    try {
      const keystore = await getKeystore();
      await keystore.restore(text);
      // Typing the phrase proves they have it, so this wallet counts as backed up and sending
      // is not blocked. Asking someone to write down what they just read off paper would be
      // theatre.
      setText('');
      router.replace('/wallet');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That phrase could not be used.');
    } finally {
      setBusy(false);
    }
  }

  return <Screen title="Restore your wallet" subtitle="Enter your recovery phrase">
    <Card>
      <Note>Type or paste your twelve or twenty-four words, separated by spaces. Numbering and capitals do not matter.</Note>
    </Card>

    <View style={[shared.input, { minHeight: 140 }]}>
      <TextInput
        accessibilityLabel="Your recovery phrase"
        value={text}
        onChangeText={setText}
        placeholder="abandon ability able…"
        placeholderTextColor={c.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        textAlignVertical="top"
        style={{ flex: 1, fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: c.ink }}
      />
    </View>

    {/* A live count, because a missed or doubled word is invisible in a wall of twelve and is
        the mistake people actually make. */}
    <Label size={12} color={count && !shape.ok ? c.orange : c.muted}>
      {count === 0 ? 'No words yet' : `${count} ${count === 1 ? 'word' : 'words'}${shape.ok ? ' · looks right' : ''}`}
    </Label>

    {!!text.trim() && !shape.ok && <Note error>{shape.ok === false ? shape.reason : ''}</Note>}

    {!!error && <Card>
      <Label weight="semibold">That phrase could not be used</Label>
      <Note error>{error}</Note>
      <Note>Nothing was saved. Check for a mistyped or missing word — the order matters too.</Note>
    </Card>}

    {!keystoreAvailable && <Card><Label weight="semibold">Not available here</Label><Note>{keystoreUnavailableReason()}</Note></Card>}

    <Button
      label={busy ? 'Restoring…' : 'Restore wallet'}
      onPress={() => { void restore(); }}
      disabled={busy || !shape.ok || !keystoreAvailable}
    />
    <Button secondary label="Cancel" onPress={() => router.back()} />
  </Screen>;
}
