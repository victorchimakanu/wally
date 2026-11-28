import { CustodyGuard } from '../components/WalletData';
import React, { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import { WalletOverview } from '../components/WalletOverview';
import { Watchlist } from '../components/MarketRows';
import { TransferRow } from '../components/TransferRow';
import { Lockup, WallyAsset } from '../components/WallyAsset';
import { Button, Card, Group, Label, Row, Screen, useShared } from '../components/ui';
import { useShell } from '../components/shell';
import { money, units } from '../demo/model';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { liveTransferSummary, nameFor, shortAddress } from '../services/transfer-summary';
import { whenLabel } from '../services/when';
import { fonts, makeStyles, useColors } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveHistoryScreen } from './LiveWallet';

export function WelcomeScreen() {
  const c = useColors();
  const s = useStyles();
  const wallet = useWallet();
  const { state, update } = useDemo();
  if (state.welcomed) return <Redirect href="/wallet" />;
  return <Screen contentStyle={{ paddingTop: 10 }} footer={<Button label={wallet.enabled ? 'Open testnet wallet' : 'Try the demo'} onPress={() => { update({ welcomed: true }); router.replace('/wallet'); }} />}>
    <Lockup size={118} style={{ alignSelf: 'flex-start' }} />
    <View style={s.illustration} accessibilityLabel="Wallet with a Send 25 USDT conversation bubble">
      <View style={s.illustratedWallet}><Lockup onBrand size={84} style={{ alignSelf: 'flex-start' }} /><Label size={40} color={c.onBrand} weight="semibold" style={{ marginTop: 12 }}>₮</Label></View>
      <View style={s.bubble}><Label size={16} weight="medium">“Send 25 USDT”</Label></View>
    </View>
    <Label size={32} weight="semibold" accessibilityRole="header">Your money.{'\n'}Just ask Wally.</Label>
  </Screen>;
}

/**
 * The balance leads at every width: the card with its tab, the two actions as tiles under it,
 * and the custody line as a footnote. Wider windows put recent activity beside that column;
 * desktop stacks the watchlist under the activity, as the desktop board does, and tablets run
 * it full width below. The same order everywhere: card, actions, activity, watchlist.
 */
export function WalletScreen() {
  const shared = useShared();
  const { wide, tablet } = useShell();
  const wallet = useWallet();
  const { setDraft } = useDemo();
  const send = () => { setDraft({ recipient: '', amount: '' }); router.push('/send'); };
  const receive = () => router.push('/receive');
  // A refused split is the one notice that goes above the card: this screen then falls back to
  // the demo wallet, and the real balances would otherwise vanish without a word.
  // Sending needs the wallet server; while it is unreachable the Send tile goes grey, as the
  // quick tools' Offline variant does, and Receive stays available.
  const disconnected = wallet.enabled && (!wallet.snapshot || wallet.offline);
  const hero = <View style={{ gap: 24 }}>
    {!!wallet.blocked && <CustodyGuard />}
    <WalletOverview />
    <View style={shared.row}><ActionTile label="Send" disabled={disconnected} onPress={send} /><ActionTile label="Receive" accent onPress={receive} /></View>
    {!wallet.blocked && <CustodyGuard />}
  </View>;
  if (wide) return <Screen tab="wallet" wideContent contentStyle={{ gap: 24 }}>
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ width: 384 }}>{hero}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 24 }}><RecentActivity /><Watchlist /></View>
    </View>
  </Screen>;
  if (tablet) return <Screen tab="wallet" contentStyle={{ gap: 24 }}>
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ width: 384 }}>{hero}</View>
      <View style={{ flex: 1, minWidth: 0 }}><RecentActivity /></View>
    </View>
    <Watchlist />
  </Screen>;
  return <Screen tab="wallet" contentStyle={{ gap: 24 }}>{hero}<Watchlist /></Screen>;
}

/** The two quick actions from the Home boards: Send in ink, Receive in yellow, 104 tall; a disabled tile goes grey. */
function ActionTile({ label, accent = false, disabled = false, onPress }: { label: string; accent?: boolean; disabled?: boolean; onPress: () => void }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [{ flex: 1, minHeight: 104, borderRadius: 24, padding: 20, justifyContent: 'flex-end', backgroundColor: disabled ? c.toggle : accent ? c.yellow : c.brand }, pressed && { opacity: 0.85 }]}>
    <Label size={18} weight="semibold" color={disabled ? c.muted : accent ? c.onAccent : c.onBrand}>{label}</Label>
  </Pressable>;
}

const DEMO_STATUS = { pending: 'Pending', confirmed: 'Confirmed', failed: 'Failed' } as const;

/** The latest three transfers as a list, the full list one row further. */
function RecentActivity() {
  const wallet = useWallet();
  return wallet.enabled ? <LiveRecentActivity /> : <DemoRecentActivity />;
}
function DemoRecentActivity() {
  const { state } = useDemo();
  const { preferences } = usePreferences();
  const latest = state.transactions.slice(0, 3);
  return <Group title="Recent activity">
    {latest.map(tx => <TransferRow key={tx.id} title={`To ${nameFor(tx.recipient, preferences.recipients) ?? shortAddress(tx.recipient)}`} meta={`${DEMO_STATUS[tx.status]} · Arbitrum`} amount={`${tx.status === 'failed' ? '' : '−'}${money(units(tx.amount) ?? 0)} USDt`} when={whenLabel(tx.submittedAt)} failed={tx.status === 'failed'} onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} />)}
    {!latest.length && <Row title="No transfers yet" />}
    <Row title="View all" onPress={() => router.push('/history')} />
  </Group>;
}
function LiveRecentActivity() {
  const wallet = useWallet();
  const { preferences } = usePreferences();
  const { refreshHistory } = wallet;
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  const owned = wallet.snapshot?.balances.map(item => item.address) ?? [];
  const items = wallet.history?.items.slice(0, 3) ?? [];
  // One line for the states with no rows; the card's tab already carries the error and Refresh.
  const empty = items.length ? null : wallet.history ? 'No transfers yet' : wallet.historyLoading ? 'Loading…' : wallet.error || wallet.historyError ? 'Not connected' : 'Not loaded yet';
  return <Group title="Recent activity">
    {items.map(item => { const summary = liveTransferSummary(item, owned, preferences.recipients); return <TransferRow key={`${item.chain}:${item.hash}`} title={summary.title} meta={summary.meta} amount={summary.amount} when={item.submittedAt ? whenLabel(item.submittedAt) : undefined} failed={summary.failed} onPress={() => router.push({ pathname: '/transaction', params: { chain: item.chain, hash: item.hash } })} />; })}
    {!!empty && <Row title={empty} />}
    <Row title="View all" onPress={() => router.push('/history')} />
  </Group>;
}

export function ChatsScreen() {
  const { state, newChat } = useDemo();
  return <Screen title="Chats" tab="chats">
    <Button label="New chat" onPress={() => router.push({ pathname: '/chat', params: { id: newChat() } })} />
    <Group>{state.chats.map(chat => <Row key={chat.id} title={chat.title} onPress={() => router.push({ pathname: '/chat', params: { id: chat.id } })} />)}</Group>
  </Screen>;
}

export function HistoryScreen() {
  const wallet = useWallet();
  if (wallet.blocked) return <Screen title="Activity"><CustodyGuard /></Screen>;
  return wallet.enabled ? <LiveHistoryScreen /> : <DemoHistoryScreen />;
}
/** Demo transfers are all outgoing, so there is nothing to filter: search and the list. */
function DemoHistoryScreen() {
  const c = useColors();
  const s = useStyles();
  const shared = useShared();
  const { state } = useDemo();
  const [search, setSearch] = useState('');
  const transactions = state.transactions.filter(tx => `${tx.recipient} ${tx.amount} ${tx.status}`.toLowerCase().includes(search.toLowerCase()));
  if (!state.transactions.length) return <Screen title="Activity"><Card><Label size={18} weight="semibold">No transfers yet</Label><Button label="Send" onPress={() => router.push('/send')} /></Card></Screen>;
  return <Screen title="Activity">
    <View style={[shared.row, shared.input]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search activity" placeholder="Search" placeholderTextColor={c.muted} value={search} onChangeText={setSearch} style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: c.ink }} /></View>
    <Group>{transactions.map(tx => <Pressable key={tx.id} accessibilityRole="button" accessibilityLabel={`${tx.status === 'confirmed' ? 'Sent' : tx.status === 'pending' ? 'Sending' : 'Failed'} ${tx.amount} USDt to ${tx.recipient}`} onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} style={({ pressed }) => [s.activity, pressed && { backgroundColor: c.toggle }]}>
      <View style={shared.flex}><Label numberOfLines={1}>To {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label>{tx.status !== 'confirmed' && <Label size={13} color={tx.status === 'failed' ? c.error : c.muted}>{tx.status === 'pending' ? 'Pending' : 'Failed'}</Label>}</View>
      <View style={{ alignItems: 'flex-end' }}><Label>−{tx.amount} USDt</Label><Label size={13} color={c.muted}>{new Date(tx.submittedAt).toLocaleDateString()}</Label></View>
    </Pressable>)}</Group>
  </Screen>;
}

const useStyles = makeStyles(c => ({
  illustration: { width: 300, maxWidth: '100%', height: 244, borderRadius: 40, backgroundColor: c.tint, alignSelf: 'center', marginTop: 26, marginBottom: 12 },
  illustratedWallet: { position: 'absolute', top: 39, left: 32, width: 228, height: 146, borderRadius: 24, backgroundColor: c.brand, paddingHorizontal: 20, paddingTop: 15 },
  bubble: { position: 'absolute', right: 15, bottom: 32, width: 202, minHeight: 70, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
}));
