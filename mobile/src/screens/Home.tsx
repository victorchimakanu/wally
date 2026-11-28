import { CustodyGuard, LiveActivityCard } from '../components/WalletData';
import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import { WalletOverview } from '../components/WalletOverview';
import { Watchlist } from '../components/MarketRows';
import { Lockup, WallyAsset } from '../components/WallyAsset';
import { Button, Card, Group, Label, LinkButton, Row, Screen, useShared } from '../components/ui';
import { useShell } from '../components/shell';
import { useDemo } from '../demo/store';
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

export function WalletScreen() {
  const shared = useShared();
  const { wide, tablet } = useShell();
  const { setDraft } = useDemo();
  const send = () => { setDraft({ recipient: '', amount: '' }); router.push('/send'); };
  const receive = () => router.push('/receive');
  // The guard sits above the overview, not below it. In a refused split this screen falls back
  // to the demo wallet, which is safe but silent — the real balances simply vanish with no
  // explanation. The card says which wallet is missing and why.
  const overview = <><CustodyGuard /><WalletOverview /></>;
  // Two actions, not a grid of shortcuts: Market and Chat already have their own places.
  // Wider windows follow the designs: the overview keeps its phone width in a left column. On
  // desktop the watchlist fills the rest; an upright tablet stacks the actions beside the card.
  if (wide) return <Screen tab="wallet" wideContent contentStyle={{ gap: 24 }}>
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ width: 384, gap: 24 }}>{overview}<View style={shared.row}><Button label="Send" style={shared.flex} onPress={send} /><Button accent label="Receive" style={shared.flex} onPress={receive} /></View></View>
      <View style={{ flex: 1, minWidth: 0 }}><Watchlist /></View>
    </View>
  </Screen>;
  // A tablet follows the Tablet · Home board: the card keeps its column, the actions sit beside
  // it as two tiles with recent activity under them, and the watchlist runs the full width.
  if (tablet) return <Screen tab="wallet" contentStyle={{ gap: 24 }}>
    <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
      <View style={{ width: 384, gap: 24 }}>{overview}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 24 }}>
        <View style={shared.row}><ActionTile label="Send" onPress={send} /><ActionTile label="Receive" accent onPress={receive} /></View>
        <RecentActivity />
      </View>
    </View>
    <Watchlist />
  </Screen>;
  return <Screen tab="wallet" contentStyle={{ gap: 24 }}>
    {overview}
    <View style={shared.row}>
      <Button label="Send" style={shared.flex} onPress={send} />
      <Button accent label="Receive" style={shared.flex} onPress={receive} />
    </View>
    <Watchlist />
  </Screen>;
}

/** The wallet's two actions as tiles, the primary in ink and the accent in yellow like the buttons. */
function ActionTile({ label, accent = false, onPress }: { label: string; accent?: boolean; onPress: () => void }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [{ flex: 1, minHeight: 112, borderRadius: 24, padding: 20, justifyContent: 'flex-end', backgroundColor: accent ? c.yellow : c.brand }, pressed && { opacity: 0.85 }]}>
    <Label size={18} weight="semibold" color={accent ? c.onAccent : c.onBrand}>{label}</Label>
  </Pressable>;
}

/** The latest three transfers, with the full list one tap away. Live wallets reuse the activity card. */
function RecentActivity() {
  const c = useColors();
  const shared = useShared();
  const wallet = useWallet();
  const { state } = useDemo();
  if (wallet.enabled) return <LiveActivityCard compact />;
  const latest = state.transactions.slice(0, 3);
  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  return <Card>
    <View style={shared.between}><Label size={18} weight="semibold">Recent activity</Label><LinkButton label="View all" onPress={() => router.push('/history')} /></View>
    {latest.length === 0 ? <Label size={14} color={c.muted}>No transfers yet.</Label> : <Group>{latest.map(item => <Row key={item.id} title={`To ${short(item.recipient)}`} value={`${item.status === 'failed' ? '' : '−'}${item.amount} USDt`} onPress={() => router.push('/history')} />)}</Group>}
  </Card>;
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
