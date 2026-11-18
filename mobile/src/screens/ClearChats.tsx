import React, { useState } from 'react';
import { router } from 'expo-router';
import { Button, Card, Group, Label, Note, Row, Screen } from '../components/ui';
import { entryFor } from '../services/app-data';
import { useDemo } from '../demo/store';

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

  if (done) return <Screen title="Chats cleared">
    <Note>Your wallet, recovery phrase and saved recipients are unchanged.</Note>
    <Button label="Done" onPress={() => router.back()} />
  </Screen>;

  // What goes and what stays, as two lists: the screen answers "will this touch my money?"
  // before anyone has to ask it.
  return <Screen title="Clear chats">
    <Group title="Deletes">
      <Row title={entryFor('chats').label} value={messages === 1 ? '1 message' : `${messages.toLocaleString('en-US')} messages`} />
      <Row title="Simulated transfers in Activity" />
    </Group>
    <Group title="Keeps">
      <Row title="Wallet and recovery phrase" />
      <Row title="Saved recipients" />
      <Row title="Real transfers on the blockchain" />
    </Group>

    {!!failed && <Card>
      <Label weight="semibold">The chats were not cleared</Label>
      <Note error>{failed}</Note>
    </Card>}

    <Button label={busy ? 'Clearing…' : 'Clear every message'} onPress={() => { void clear(); }} disabled={busy} />
    <Button secondary label="Cancel" onPress={() => router.back()} />
  </Screen>;
}
