import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Label, Note, Screen } from '../components/ui';
import { readCrashes, clearCrashes } from '../services/crash-log-device';
import { reportText, type CrashRecord } from '../services/crash-log';
import { colors as c } from '../theme';

/**
 * The problem reports this device has recorded, and the choice to hand them over.
 *
 * Wally has no crash reporting service and this screen is the reason it does not need one yet.
 * Nothing here is uploaded: a stack trace from a wallet is exactly the kind of thing that
 * should not leave a device without the owner deciding, and sending it automatically is a
 * product decision nobody has made.
 *
 * Everything shown has already been through `scrubCrash` once on the way in and once more on
 * the way out, so a recovery phrase or a key cannot reach the clipboard from here.
 */
export function ProblemsScreen() {
  const [records, setRecords] = useState<CrashRecord[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);

  const load = useCallback(() => { void readCrashes().then(setRecords).catch(() => setRecords([])); }, []);
  useEffect(load, [load]);

  async function copy() {
    try { setCopied(await Clipboard.setStringAsync(reportText(records ?? []))); }
    catch { setCopied(false); }
  }

  if (!records) return <Screen title="Problem reports"><Note>Reading…</Note></Screen>;

  return <Screen title="Problem reports">
    {!records.length && <Label color={c.muted}>Nothing has gone wrong.</Label>}

    {records.map(record => <Card key={`${record.at}-${record.message}`}>
      <Label size={13} color={c.muted}>{new Date(record.at).toLocaleString()} · {record.kind}</Label>
      <Label size={14} selectable>{record.message}</Label>
      <Label size={12} color={c.muted} selectable>{record.build}</Label>
      {!!record.stack && <Label size={11} color={c.muted} selectable>{record.stack.split('\n').slice(0, 6).join('\n')}</Label>}
    </Card>)}

    {!!records.length && <View style={{ gap: 10 }}>
      <Button label={copied ? 'Copied' : 'Copy all reports'} onPress={() => { void copy(); }} />
      <Button secondary label={cleared ? 'Cleared' : 'Delete these reports'} onPress={() => { void clearCrashes().then(() => { setCleared(true); setRecords([]); }); }} />
    </View>}
  </Screen>;
}
