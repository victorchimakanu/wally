import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { entryFor } from '../services/app-data';
import { useDemo } from '../demo/store';
import { colors as c } from '../theme';

/**
 * Delete every message, without touching the wallet.
 *
 * FEATURE-AUDIT §11.5: chats persisted to the phone with no way to clear them short of
 * uninstalling the app. That is the gap worth closing most, because the alternative people
 * reach for — deleting the app — takes the wallet with it, and on a phone whose recovery
 * phrase was never written down that is the money gone.
 *
 * Separate from "Remove this wallet" on purpose. Wanting a conversation off the phone is not
 * wanting to leave, and a single button that did both would make the cheap action cost the
 * expensive one.
 */
export function ClearChatsScreen() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState('');
  const { state, clearHistory } = useDemo();

  const messages = state.chats.reduce((total, chat) => total + chat.messages.length, 0);

  async function clear() {
    setBusy(true);
    setFailed('');
    try {
      // The store owns this: the chats and the simulated transfers are one stored value, and
      // clearing it correctly means memory, then storage, then writing the emptied state back
      // so that a restart does not fall through to the samples. See `clearHistory`.
      // Not `reset()` — that restores the sample conversations, which is not what was asked.
      await clearHistory();
      setDone(true);
    } catch (problem) {
      setFailed(problem instanceof Error ? problem.message : 'This phone refused the deletion.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Screen title="Chats cleared" subtitle="Your wallet is untouched">
    <Card>
      <Pill tone="success">NOTHING LEFT TO READ</Pill>
      <Note>Every message is off this phone, and the chat list is empty. Your wallet, your recovery phrase and your saved recipients are exactly as they were.</Note>
    </Card>
    <Note>Wally never sent your chats anywhere, so there is no copy elsewhere to delete.</Note>
    <Button label="Done" onPress={() => router.back()} />
  </Screen>;

  return <Screen title="Clear chat history" subtitle="Your wallet is not affected">
    <Card>
      <Label size={12} weight="semibold" color={c.orange}>WHAT THIS DELETES</Label>
      <Label size={14}>· {entryFor('chats').label}</Label>
      <Label size={14}>· Your simulated transfers in Activity</Label>
      <Note>{messages === 1 ? 'One message on this phone.' : `${messages.toLocaleString('en-US')} messages on this phone.`} The simulated transfers go too — they are saved in the same place, and there is no deleting half a file.</Note>
    </Card>

    <Card>
      <Label size={16} weight="medium">What stays</Label>
      <View style={{ gap: 2 }}>
        <Label size={14}>· Your wallet and recovery phrase</Label>
        <Label size={14}>· Your saved recipients</Label>
        <Label size={14}>· Your real transfers, which are on the blockchain and cannot be deleted by anyone — not by us, not by you</Label>
      </View>
      <Note>Clearing a chat does not undo anything it did. A transfer that went through has gone through.</Note>
    </Card>

    {!!failed && <Card>
      <Label weight="semibold">The chats were not cleared</Label>
      <Note error>{failed}</Note>
      <Note>They are still on this phone. Nothing else was changed.</Note>
    </Card>}

    <Button label={busy ? 'Clearing…' : 'Clear every message'} onPress={() => { void clear(); }} disabled={busy} />
    <Button secondary label="Keep my chats" onPress={() => router.back()} />
  </Screen>;
}
