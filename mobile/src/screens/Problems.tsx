import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
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

  return <Screen title="Problem reports" subtitle={records.length ? `${records.length} recorded on this phone` : 'Nothing has gone wrong'}>
    <Card>
      <Pill tone={records.length ? 'warning' : 'success'}>{records.length ? `${records.length} RECORDED` : 'NOTHING RECORDED'}</Pill>
      <Note>Wally writes down what went wrong so it can be fixed. These stay on this phone —
      nothing is uploaded, and no account is involved.</Note>
      <Note>Recovery phrases, keys and full addresses are removed before anything is written.
      Addresses appear shortened so a report can say which wallet without saying anything else.</Note>
    </Card>

    {!records.length && <Card><Note>If something breaks, it will appear here with the time and the build it happened on.</Note></Card>}

    {records.map(record => <Card key={`${record.at}-${record.message}`}>
      <Label size={12} weight="semibold" color={c.orange}>{new Date(record.at).toLocaleString()} · {record.kind.toUpperCase()}</Label>
      <Label size={14} selectable>{record.message}</Label>
      <Label size={12} color={c.muted} selectable>{record.build}</Label>
      {!!record.stack && <Label size={11} color={c.muted} selectable>{record.stack.split('\n').slice(0, 6).join('\n')}</Label>}
    </Card>)}

    {!!records.length && <View style={{ gap: 10 }}>
      <Button label={copied ? 'Copied' : 'Copy all reports'} onPress={() => { void copy(); }} />
      <Button secondary label={cleared ? 'Cleared' : 'Delete these reports'} onPress={() => { void clearCrashes().then(() => { setCleared(true); setRecords([]); }); }} />
    </View>}
    <Button secondary label="Back" onPress={() => router.back()} />
  </Screen>;
}
