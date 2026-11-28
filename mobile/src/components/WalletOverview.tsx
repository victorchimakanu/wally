import React from 'react';
import { router } from 'expo-router';
import { WalletCard, type WalletTab } from './WalletCard';
import { Card, Detail } from './ui';
import { useDemo } from '../demo/store';
import { money, units } from '../demo/model';
import { usePreferences } from '../demo/preferences';
import { fiatValue } from '../services/fiat-value';
import { formatPrice } from '../services/market-api';
import { nameFor } from '../services/transfer-summary';
import { useMarket } from '../data/market';
import { useWallet } from '../data/wallet';
import { LiveWalletOverview } from './WalletData';

export function WalletOverview({ balance, transactionId, snapshot = false }: { balance?: number; transactionId?: string; snapshot?: boolean } = {}) {
  const wallet = useWallet();
  return wallet.enabled && !snapshot ? <LiveWalletOverview /> : <DemoWalletOverview balance={balance} transactionId={transactionId} snapshot={snapshot} />;
}

const DEMO_STATUS = { pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed' } as const;

/** The demo's fictional USDt on the shared card; the tab shows its latest transfer and opens Activity. */
function DemoWalletOverview({ balance, transactionId, snapshot = false }: { balance?: number; transactionId?: string; snapshot?: boolean }) {
  const { state } = useDemo();
  const { preferences } = usePreferences();
  const market = useMarket();
  const displayedBalance = balance ?? state.balance;
  // Fictional funds priced like real ones, so the demo shows the dollars-to-naira idea itself.
  const fiat = fiatValue(String(displayedBalance / 1_000_000), 'USDT', market.data?.assets ?? [], market.currency);
  const latest = snapshot ? state.transactions.find(item => item.id === transactionId) : state.transactions[0];
  const activity = () => router.push('/history');
  const tab: WalletTab = latest
    ? (() => {
      const name = nameFor(latest.recipient, preferences.recipients);
      const verb = latest.status === 'pending' ? 'Sending' : latest.status === 'failed' ? 'Failed' : 'Sent';
      return { title: `${verb} ${money(units(latest.amount) ?? 0)} USDt${name ? ` to ${name}` : ''}`, meta: `${DEMO_STATUS[latest.status]} · Arbitrum`, onPress: activity };
    })()
    : { title: 'No activity yet', onPress: activity };
  const priced = fiat.amount === null ? undefined : formatPrice(fiat.amount, fiat.currency);
  // A chat answer is the bare card: the balance it was asked for, nothing to tap around it.
  return <WalletCard inline={snapshot} amount={money(displayedBalance)} unit="USDt" line={priced} lineLabel={priced && `About ${priced}`} tab={snapshot ? undefined : tab}>
    <Card><Detail label="Arbitrum" value={`${money(displayedBalance)} USDt`} /><Detail label="Ethereum" value="0.042 ETH" /><Detail label="Bitcoin" value="0.0012 BTC" /></Card>
  </WalletCard>;
}
