import React, { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { TextInput, View } from 'react-native';
import { Button, Card, Label, Note, Pill, Screen, useShared } from '../components/ui';
import { backupPositions, checkBackup, phraseWords } from '../services/recovery';
import { getKeystore } from '../services/wallet-worklet';
// Extensionless: Metro picks the native implementation on a phone and the no-op on web.
import { useScreenPrivacy } from '../services/screen-privacy';
import { requireUnlock } from '../services/unlock';
import { fonts, useColors } from '../theme';

/**
 * The twelve words, and the check that the user really wrote them down.
 *
 * Two entry points, one screen:
 *   mode=setup  straight after creation — show, then confirm, then sending is unblocked
 *   mode=view   from Settings, later — show only
 *
 * **Screen capture is blocked while this is mounted.** A recovery phrase in the camera roll is
 * in a cloud backup minutes later, which quietly undoes the whole point of keys living on the
 * phone. Verified against expo-screen-capture's own docs: it prevents recordings on iOS 11+
 * and screenshots on iOS 13+, and sets FLAG_SECURE on Android. On an older iOS it does
 * nothing, which is why the screenshot listener below is also wired up — if we cannot prevent
 * it, the user should at least be told it happened.
 *
 * Re-viewing is deliberately allowed. People genuinely lose phrases, and refusing would push
 * them to photograph the phrase during setup, which is worse. The honest caveat is on screen:
 * with no app lock yet (FEATURE-AUDIT §2.1, the next PR), anyone holding the unlocked phone
 * can reach this.
 */
export function RecoveryPhraseScreen() {
  const c = useColors();
  const shared = useShared();
  const { screenshotted } = useScreenPrivacy('wally.recovery-phrase');

  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const setup = mode === 'setup';

  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'show' | 'confirm'>('show');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  // Bumped to retry after a refused unlock, rather than leaving the user on a dead end.
  const [attempt, setAttempt] = useState(0);
  const [refused, setRefused] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Asked every time, including straight after creation. A carve-out for "they just made
        // it, so they must be the owner" is exactly the kind of exception that becomes a hole,
        // and the prompt is one tap.
        const unlocked = await requireUnlock('phrase');
        if (!unlocked.ok) { if (live) setRefused(unlocked.message); return; }
        if (live) setRefused('');

        const keystore = await getKeystore();
        const revealed = await keystore.reveal();
        if (live) setPhrase(revealed);
      } catch (problem) {
        if (live) setError(problem instanceof Error ? problem.message : 'The recovery phrase could not be read.');
      }
    })();
    // Dropping the reference on unmount is the only control available: a JS string cannot be
    // zeroed, which the worklet's own handler notes as a known accepted gap.
    return () => { live = false; setPhrase(null); };
  }, [attempt]);

  const words = useMemo(() => (phrase ? phraseWords(phrase) : []), [phrase]);
  // Fixed once per visit, so re-rendering while typing does not reshuffle which words are
  // asked about underneath the user.
  const positions = useMemo(
    () => (words.length ? backupPositions(words.length, 3, Math.random) : []),
    [words.length],
  );

  async function confirm() {
    const result = checkBackup(words, positions, answers);
    setWrong(result.wrong);
    if (!result.ok) return;
    setBusy(true);
    try {
      const keystore = await getKeystore();
      await keystore.confirmBackedUp();
      router.replace('/wallet');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <Screen title="Recovery phrase">
      <Card><Label weight="semibold">The phrase could not be shown</Label><Note error>{error}</Note><Note>Nothing has changed and your funds are untouched.</Note></Card>
      <Button secondary label="Back" onPress={() => router.back()} />
    </Screen>;
  }

  if (refused) {
    return <Screen title="Recovery phrase">
      <Card><Label weight="semibold">Not shown</Label><Note error>{refused}</Note></Card>
      <Button label="Try again" onPress={() => setAttempt(attempt + 1)} />
      <Button secondary label="Back" onPress={() => router.back()} />
    </Screen>;
  }

  if (!phrase) {
    return <Screen title="Recovery phrase"><Card><Label weight="semibold">Reading your phrase…</Label></Card></Screen>;
  }

  if (setup && stage === 'confirm') {
    return <Screen title="Check your backup">
      <Note>Type these words from your paper, not from this phone.</Note>
      {positions.map(position => <Card key={position}>
        <Label size={13} weight="medium" color={c.muted}>Word {position + 1}</Label>
        <View style={[shared.row, shared.input, wrong.includes(position) ? { borderColor: c.orange } : null]}>
          <TextInput
            accessibilityLabel={`Word ${position + 1} of your recovery phrase`}
            value={answers[position] ?? ''}
            onChangeText={text => setAnswers({ ...answers, [position]: text })}
            placeholder={`The ${position + 1}${position === 0 ? 'st' : position === 1 ? 'nd' : position === 2 ? 'rd' : 'th'} word`}
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: 1, fontSize: 16, fontFamily: fonts.regular, color: c.ink }}
          />
        </View>
      </Card>)}
      {!!wrong.length && <Card><Label weight="semibold">That does not match</Label><Note error>{wrong.length === 1 ? 'One word is wrong.' : `${wrong.length} words are wrong.`} Check your paper.</Note></Card>}
      <Button label={busy ? 'Saving…' : 'Confirm'} onPress={() => { void confirm(); }} disabled={busy} />
      <Button secondary label="Show me the words again" onPress={() => { setStage('show'); setWrong([]); setAnswers({}); }} />
    </Screen>;
  }

  return <Screen title="Recovery phrase">
    <Card style={{ backgroundColor: c.surface }}>
      <Pill tone="warning">Anyone with these words can spend your money</Pill>
      <Note>Write them on paper. Don’t photograph them or type them anywhere.</Note>
    </Card>

    <Card>
      {/* Numbered, because the order is part of the phrase and a list of twelve words is
          surprisingly easy to transcribe out of sequence. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {words.map((word, index) => <View key={`${index}-${word}`} style={{ width: '50%', paddingVertical: 6, flexDirection: 'row', gap: 8 }}>
          <Label size={12} color={c.muted} style={{ width: 20, textAlign: 'right' }}>{index + 1}</Label>
          <Label size={15} weight="medium" selectable>{word}</Label>
        </View>)}
      </View>
    </Card>

    {screenshotted && <Card>
      <Label weight="semibold">You took a screenshot</Label>
      <Note error>Photos usually back up to the cloud. Delete it and use paper instead.</Note>
    </Card>}

    {setup
      ? <Button label="I have written them down" onPress={() => setStage('confirm')} />
      : <Button secondary label="Done" onPress={() => router.back()} />}
  </Screen>;
}
