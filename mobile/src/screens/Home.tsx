import { CustodyGuard } from '../components/WalletData';
import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { WalletOverview } from '../components/WalletOverview';
import { Watchlist } from '../components/MarketRows';
import { WallyAsset } from '../components/WallyAsset';
import { Button, Card, Group, Label, Row, Screen, shared } from '../components/ui';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveHistoryScreen } from './LiveWallet';

export function WelcomeScreen() {
  const wallet = useWallet();
  const { state, update } = useDemo();
  if (state.welcomed) return <Redirect href="/wallet" />;
  return <Screen contentStyle={{ paddingTop: 10 }} footer={<Button label={wallet.enabled ? 'Open testnet wallet' : 'Try the demo'} onPress={() => { update({ welcomed: true }); router.replace('/wallet'); }} />}>
    <WallyAsset name="wally-lockup-light.svg" size={118} style={{ alignSelf: 'flex-start' }} />
    <View style={s.illustration} accessibilityLabel="Wallet with a Send 25 USDT conversation bubble">
      <View style={s.illustratedWallet}><WallyAsset name="wally-lockup-dark.svg" size={84} style={{ alignSelf: 'flex-start' }} /><Label size={40} color={c.surface} weight="semibold" style={{ marginTop: 12 }}>₮</Label></View>
      <View style={s.bubble}><Label size={16} weight="medium">“Send 25 USDT”</Label></View>
    </View>
    <Label size={32} weight="semibold" accessibilityRole="header">Your money.{'\n'}Just ask Wally.</Label>
  </Screen>;
}

export function WalletScreen() {
  const { setDraft } = useDemo();
  // Two actions, not a grid of shortcuts: Market and Chat already have their own tabs.
  return <Screen tab="wallet" contentStyle={{ gap: 24 }}>
    {/* Above the overview, not below it. In a refused split this screen falls back to the demo
        wallet, which is safe but silent — the real balances simply vanish with no explanation.
        The card says which wallet is missing and why. */}
    <CustodyGuard />
    <WalletOverview />
    <View style={shared.row}>
      <Button label="Send" style={shared.flex} onPress={() => { setDraft({ recipient: '', amount: '' }); router.push('/send'); }} />
      <Button accent label="Receive" style={shared.flex} onPress={() => router.push('/receive')} />
    </View>
    <Watchlist />
  </Screen>;
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

const s = StyleSheet.create({
  illustration: { width: 300, maxWidth: '100%', height: 244, borderRadius: 40, backgroundColor: c.tint, alignSelf: 'center', marginTop: 26, marginBottom: 12 },
  illustratedWallet: { position: 'absolute', top: 39, left: 32, width: 228, height: 146, borderRadius: 24, backgroundColor: c.brand, paddingHorizontal: 20, paddingTop: 15 },
  bubble: { position: 'absolute', right: 15, bottom: 32, width: 202, minHeight: 70, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  activity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 },
});
