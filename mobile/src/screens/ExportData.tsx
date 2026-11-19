import { CustodyGuard } from '../components/WalletData';
import React, { useState } from 'react';
import { Button, Card, Label, Note, Pill, Screen } from '../components/ui';
import { useWallet } from '../data/wallet';
import { fetchProxyHistory, type Chain } from '../services/wallet-api';
import {
  collectHistory, describeGaps, exportFilename, historyCsv, isComplete,
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

  if (wallet.blocked) return <Screen title="Export history"><CustodyGuard /></Screen>;

  if (!wallet.enabled) return <Screen title="Export history">
    <Note>Nothing to export: demo transfers are simulated, not a financial record.</Note>
  </Screen>;

  const gaps = found ? describeGaps(found) : [];
  const whole = found ? isComplete(found) : false;

  return <Screen title="Export history">
    {!!found && <Card>
      <Pill tone={whole ? 'success' : 'warning'}>{whole ? 'Complete' : 'Some transfers are missing'}</Pill>
      <Label size={16}>{found.items.length === 1 ? '1 transfer found' : `${found.items.length.toLocaleString('en-US')} transfers found`}</Label>
      {!whole && <>
        <Note error>Do not file this as a complete record.</Note>
        {gaps.map(gap => <Note key={gap} error>· {gap}</Note>)}
        <Note>The file name says PARTIAL.</Note>
      </>}
    </Card>}

    {!!error && <Card>
      <Label weight="semibold">Nothing was exported</Label>
      <Note error>{error}</Note>
    </Card>}

    {!!sent && <Note>{sent}</Note>}

    {!found
      ? <Button label={busy ? 'Reading your history…' : 'Read my history'} onPress={() => { void gather(); }} disabled={busy || !chains.length} />
      : <Button
          label={busy ? 'Writing…' : whole ? 'Save CSV' : 'Save partial CSV'}
          onPress={() => { void write(found); }}
          disabled={busy}
        />}
    {!!found && <Button secondary label="Check again" onPress={() => { void gather(); }} disabled={busy} />}
  </Screen>;
}
