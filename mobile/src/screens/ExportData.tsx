import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { useWallet } from '../data/wallet';
import { colors as c } from '../theme';
import { fetchProxyHistory, type Chain } from '../services/wallet-api';
import {
  CSV_COLUMNS, collectHistory, describeGaps, exportFilename, historyCsv, isComplete,
  type Collected,
} from '../services/history-export';
import { deliverCsv } from '../services/history-export-device';

/**
 * Take your transaction history with you.
 *
 * FEATURE-AUDIT §11.2 and §11.3. §11.3 is the one with a deadline that is not ours: people
 * need records for tax, and the app could produce none.
 *
 * The screen is arranged around one risk. A tax record that is quietly missing transfers is
 * worse than no record at all, because the person files it believing it is complete. So the
 * export is gathered first and judged second: when anything is missing, the file is still
 * offered — someone who can file their Arbitrum transfers today is better served than someone
 * handed nothing — but it is named PARTIAL, the gaps are listed in words, and the button that
 * writes it says what it is writing.
 *
 * The warnings deliberately do not go inside the CSV. A comment row breaks every parser that
 * reads it, so the filename carries what the file cannot.
 */
export function ExportDataScreen() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Collected | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const owned: Partial<Record<Chain, string>> = Object.fromEntries(
    (wallet.snapshot?.balances ?? []).map(item => [item.chain, item.address]),
  );
  const chains = [...new Set(Object.keys(owned))] as Chain[];

  async function gather() {
    setBusy(true); setError(''); setSent(''); setFound(null);
    try {
      // One chain at a time. Asking the route for both merges them and slices back to fifty,
      // which drops records that no later page returns — see HistoryPageOptions.chain.
      const result = await collectHistory(chains, (chain, page) =>
        fetchProxyHistory({ [chain]: owned[chain] }, fetch, { chain, page }));
      setFound(result);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Your history could not be read.');
    } finally { setBusy(false); }
  }

  async function write(result: Collected) {
    setBusy(true); setError('');
    try {
      const name = exportFilename(new Date(), isComplete(result));
      const how = await deliverCsv(name, historyCsv(result.items, owned));
      setSent(how === 'downloaded' ? `${name} has been downloaded.` : `${name} is ready to send.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The file could not be saved.');
    } finally { setBusy(false); }
  }

  if (!wallet.enabled) return <Screen title="Export your history" subtitle="Nothing to export yet">
    <Card>
      <Pill>NO LIVE WALLET</Pill>
      <Note>This build has no wallet connected, so there are no transfers to export. The demo transfers on the Activity screen are simulated and are not a financial record.</Note>
    </Card>
    <Button secondary label="Back" onPress={() => router.back()} />
  </Screen>;

  const gaps = found ? describeGaps(found) : [];
  const whole = found ? isComplete(found) : false;

  return <Screen title="Export your history" subtitle="A spreadsheet file of every transfer">
    <Card>
      <Label size={12} weight="semibold" color={c.orange}>WHAT YOU GET</Label>
      <Note>A CSV file — one row per transfer, opens in Excel, Google Sheets or anything your accountant uses.</Note>
      <View style={{ gap: 2 }}>
        {CSV_COLUMNS.map(column => <Label key={column} size={13}>· {column}</Label>)}
      </View>
      <Note>Amounts are exactly as the blockchain recorded them, not rounded for display.</Note>
    </Card>

    {!found && <Card>
      <Label size={16} weight="medium">Before the file is written</Label>
      <Note>Your whole history is read first, across {chains.length === 1 ? 'your chain' : 'both chains'}, so the file is not just what fits on the Activity screen. This can take a few seconds.</Note>
    </Card>}

    {!!found && <Card>
      <Pill tone={whole ? 'success' : 'warning'}>{whole ? 'COMPLETE RECORD' : 'SOME TRANSFERS ARE MISSING'}</Pill>
      <Label size={16}>{found.items.length === 1 ? '1 transfer found' : `${found.items.length.toLocaleString('en-US')} transfers found`}</Label>
      {whole
        ? <Note>Every chain answered in full. This file is the complete record this app can give.</Note>
        : <>
            <Note error>Do not file this as a complete record.</Note>
            {gaps.map(gap => <Note key={gap} error>· {gap}</Note>)}
            <Note>The file will be named PARTIAL so it cannot be mistaken for the whole thing later.</Note>
          </>}
    </Card>}

    {!!error && <Card>
      <Label weight="semibold">Nothing was exported</Label>
      <Note error>{error}</Note>
      <Note>Your history and your wallet are untouched.</Note>
    </Card>}

    {!!sent && <Card><Pill tone="success">DONE</Pill><Note>{sent}</Note></Card>}

    {!found
      ? <Button label={busy ? 'Reading your history…' : 'Read my history'} onPress={() => { void gather(); }} disabled={busy || !chains.length} />
      : <Button
          label={busy ? 'Writing…' : whole ? 'Save the complete file' : 'Save the partial file anyway'}
          onPress={() => { void write(found); }}
          disabled={busy}
        />}
    {!!found && <Button secondary label="Check again" onPress={() => { void gather(); }} disabled={busy} />}
    <Button secondary label="Back" onPress={() => router.back()} />

    <Note>This file is written on your phone and handed to whatever you choose to send it with. Wally does not upload it anywhere.</Note>
  </Screen>;
}
