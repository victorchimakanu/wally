import { CustodyGuard, LiveActivityList } from '../components/WalletData';
import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { WalletOverview } from '../components/WalletOverview';
import { Watchlist } from '../components/MarketRows';
import { SearchField } from '../components/SearchField';
import { TransferRow } from '../components/TransferRow';
import { Lockup } from '../components/WallyAsset';
import { Button, Group, Label, Row, Screen, useShared } from '../components/ui';
import { useShell } from '../components/shell';
import { listedChats, money, units, type Transaction } from '../demo/model';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { nameFor, shortAddress } from '../services/transfer-summary';
import { clockLabel, dateLabel, dayGroups, whenLabel } from '../services/when';
import { makeStyles, useColors } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveHistoryScreen } from './LiveWallet';

export function WelcomeScreen() {
  const c = useColors();
  const s = useStyles();
  const wallet = useWallet();
  const { state, update } = useDemo();
  if (state.welcomed) return <Redirect href="/wallet" />;
  // One phone-wide column, centred on anything wider: the welcome has no navigation beside it.
  return <Screen centered contentStyle={{ paddingTop: 10 }} footer={<Button label={wallet.enabled ? 'Open testnet wallet' : 'Try the demo'} onPress={() => { update({ welcomed: true }); router.replace('/wallet'); }} />}>
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

/** A demo transfer as a transfer row: the saved name when there is one, the state, the amount, and when. */
function DemoTransferRow({ tx, when }: { tx: Transaction; when: string }) {
  const { preferences } = usePreferences();
  return <TransferRow title={`To ${nameFor(tx.recipient, preferences.recipients) ?? shortAddress(tx.recipient)}`} meta={`${DEMO_STATUS[tx.status]} · Arbitrum`} amount={`${tx.status === 'failed' ? '' : '−'}${money(units(tx.amount) ?? 0)} USDt`} when={when} failed={tx.status === 'failed'} onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} />;
}

/** The latest three transfers as a list, the full list one row further. */
function RecentActivity() {
  const wallet = useWallet();
  const { state } = useDemo();
  if (wallet.enabled) return <LiveActivityList compact />;
  const latest = state.transactions.slice(0, 3);
  return <Group title="Recent activity">
    {latest.map(tx => <DemoTransferRow key={tx.id} tx={tx} when={whenLabel(tx.submittedAt)} />)}
    {!latest.length && <Row title="No transfers yet" />}
    <Row title="View all" onPress={() => router.push('/history')} />
  </Group>;
}

/**
 * Conversations by recency, Today, Yesterday and Earlier, each with when it was last touched.
 * Empty chats are placeholders the composer and New chat leave behind, so they are not listed;
 * New chat is the one action, a compact primary button rather than a row among the rows.
 */
export function ChatsScreen() {
  const { state, newChat } = useDemo();
  const chats = listedChats(state.chats);
  const open = (id: string) => router.push({ pathname: '/chat', params: { id } });
  return <Screen title="Chats" tab="chats">
    <Button label="New chat" onPress={() => open(newChat())} style={{ alignSelf: 'flex-start', paddingHorizontal: 28 }} />
    {dayGroups(chats, chat => chat.updatedAt || undefined).map(group => <Group key={group.title} title={group.title}>
      {group.items.map(chat => <Row key={chat.id} title={chat.title} value={chat.updatedAt ? (group.title === 'Earlier' ? dateLabel(chat.updatedAt) : clockLabel(chat.updatedAt)) : undefined} onPress={() => open(chat.id)} />)}
    </Group>)}
    {!chats.length && <Group><Row title="No chats yet" /></Group>}
  </Screen>;
}

export function HistoryScreen() {
  const wallet = useWallet();
  if (wallet.blocked) return <Screen title="Activity"><CustodyGuard /></Screen>;
  return wallet.enabled ? <LiveHistoryScreen /> : <DemoHistoryScreen />;
}
/**
 * Demo transfers are all outgoing, so there is nothing to filter: search, then the rows under
 * Today, Yesterday and Earlier. An empty history is one plain row, not a card with a button:
 * Send is on the Wallet, one tap away.
 */
function DemoHistoryScreen() {
  const { state } = useDemo();
  const { preferences } = usePreferences();
  const [search, setSearch] = useState('');
  const term = search.toLowerCase();
  const transactions = state.transactions.filter(tx => `${tx.recipient} ${nameFor(tx.recipient, preferences.recipients) ?? ''} ${tx.amount} ${DEMO_STATUS[tx.status]}`.toLowerCase().includes(term));
  return <Screen title="Activity">
    {state.transactions.length > 0 && <SearchField accessibilityLabel="Search activity" value={search} onChange={setSearch} />}
    {dayGroups(transactions, tx => tx.submittedAt).map(group => <Group key={group.title} title={group.title}>
      {group.items.map(tx => <DemoTransferRow key={tx.id} tx={tx} when={group.title === 'Earlier' ? whenLabel(tx.submittedAt) : clockLabel(tx.submittedAt)} />)}
    </Group>)}
    {!transactions.length && <Group><Row title={state.transactions.length ? 'No matches' : 'No transfers yet'} /></Group>}
  </Screen>;
}

const useStyles = makeStyles(c => ({
  illustration: { width: 300, maxWidth: '100%', height: 244, borderRadius: 40, backgroundColor: c.tint, alignSelf: 'center', marginTop: 26, marginBottom: 12 },
  illustratedWallet: { position: 'absolute', top: 39, left: 32, width: 228, height: 146, borderRadius: 24, backgroundColor: c.brand, paddingHorizontal: 20, paddingTop: 15 },
  bubble: { position: 'absolute', right: 15, bottom: 32, width: 202, minHeight: 70, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
}));
