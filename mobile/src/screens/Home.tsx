import React, { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { WalletOverview } from '../components/WalletOverview';
import { Watchlist } from '../components/MarketRows';
import { WallyAsset } from '../components/WallyAsset';
import { Button, Card, Icon, Item, Label, Note, Pill, Screen, shared } from '../components/ui';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveHistoryScreen } from './LiveWallet';

export function WelcomeScreen() {
  const wallet = useWallet();
  const { state, update } = useDemo();
  if (state.welcomed) return <Redirect href="/wallet" />;
  return <Screen contentStyle={{ paddingTop: 10 }} footer={<><Button label={wallet.enabled ? 'Open my testnet wallet' : 'Explore the mobile preview'} onPress={() => { update({ welcomed: true }); router.replace('/wallet'); }} /><Label size={11} color={c.muted} style={shared.center}>{wallet.enabled ? 'Real testnet wallet · Keys on your computer.\nTestnet ETH has no monetary value.' : 'A sample wallet, ready to explore.\nNo recovery phrase or real funds needed.'}</Label></>}>
    <WallyAsset name="wally-lockup-light.svg" size={118} style={{ alignSelf: 'flex-start' }} />
    <Pill>YOUR KEYS. YOUR CALL.</Pill>
    <View style={s.illustration} accessibilityLabel="Wallet with a Send 25 USDT conversation bubble">
      <View style={s.illustratedWallet}><WallyAsset name="wally-lockup-dark.svg" size={84} style={{ alignSelf: 'flex-start' }} /><Label size={40} color={c.surface} weight="semibold" style={{ marginTop: 12 }}>₮</Label></View>
      <View style={s.bubble}><Label size={16} weight="medium">“Send 25 USDT”</Label></View>
    </View>
    <Label size={32} weight="semibold" accessibilityRole="header">Your money.{'\n'}Just ask Wally.</Label>
    <Label color={c.muted}>An AI wallet designed for your phone.{'\n'}You review and approve every send.</Label>
  </Screen>;
}

export function WalletScreen() {
  const { setDraft } = useDemo();
  const tools = [
    { title: 'Send', detail: 'Transfer crypto', icon: 'ccf1e.svg', color: c.ink, action: () => { setDraft({ recipient: '', amount: '' }); router.push('/send'); } },
    { title: 'Receive', detail: 'Your wallet address', icon: 'b7222.svg', color: c.yellow, action: () => router.push('/receive') },
    { title: 'Market', detail: 'Prices & assets', icon: '56a25.svg', color: c.tint, action: () => router.push('/market') },
    { title: 'Trends', detail: '24h movers', icon: '0aca9.svg', color: c.amber, action: () => router.push({ pathname: '/market', params: { filter: 'Trends' } }) },
  ] as const;
  return <Screen tab="wallet" contentStyle={{ gap: 24 }}>
    <WalletOverview />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {tools.map(tool => <Pressable key={tool.title} accessibilityRole="button" accessibilityLabel={tool.title} onPress={tool.action} style={({ pressed }) => ({ width: '47.8%', flexGrow: 1, backgroundColor: tool.color, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 14, gap: 6, opacity: pressed ? .75 : 1 })}>
        <WallyAsset name={tool.icon} size={28} /><View style={{ gap: 4 }}><Label size={16} weight="semibold" style={{ lineHeight: 22 }} color={tool.title === 'Send' ? c.surface : c.ink}>{tool.title}</Label><Label size={12} style={{ lineHeight: 17 }} color={tool.title === 'Send' ? '#D4D9D6' : c.muted}>{tool.detail}</Label></View>
      </Pressable>)}
    </View>
    <Watchlist />
  </Screen>;
}

export function ChatsScreen() {
  const { state, newChat } = useDemo();
  return <Screen title="Your chats" subtitle="Saved on this device" tab="chats">
    <Button label="Start a new chat" onPress={() => router.push({ pathname: '/chat', params: { id: newChat() } })} />
    <Label size={11} color={c.muted} weight="medium" style={{ marginTop: 16 }}>CONVERSATIONS</Label>
    {state.chats.map(chat => <Item key={chat.id} icon={chat.id === 'sample-balance' ? 'wallet' : 'send'} title={chat.title} subtitle={chat.messages.length ? `${chat.messages.length} messages · Saved locally` : 'A fresh start'} onPress={() => router.push({ pathname: '/chat', params: { id: chat.id } })} />)}
    <Card style={{ backgroundColor: c.tint, marginTop: 30, minHeight: 151 }}><View style={shared.row}><Icon name="shield" /><Label size={13} weight="medium" style={shared.flex}>Your conversations stay here.</Label></View><Note>Chat records are stored on this device. They are not a complete record of your on-chain activity.</Note></Card>
    <Label size={11} color={c.muted} style={[shared.center, { marginTop: 32 }]}>Open a chat to continue where you left off.</Label>
  </Screen>;
}

export function HistoryScreen() { return useWallet().enabled ? <LiveHistoryScreen /> : <DemoHistoryScreen />; }
function DemoHistoryScreen() {
  const { state } = useDemo();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const transactions = state.transactions.filter(tx => filter !== 'Received' && `${tx.recipient} ${tx.amount} ${tx.status}`.toLowerCase().includes(search.toLowerCase()));
  return <Screen title="Activity">
    <View style={[shared.row, shared.input]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search activity" placeholder="Search by address or amount" placeholderTextColor={c.muted} value={search} onChangeText={setSearch} style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: c.ink }} /></View>
    <View style={shared.row}>{['All', 'Sent', 'Received'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ flex: 1, backgroundColor: filter === value ? c.ink : c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 18, paddingVertical: 10, alignItems: 'center' }}><Label size={14} color={filter === value ? c.surface : c.ink}>{value}</Label></Pressable>)}</View>
    {!transactions.length ? <Card><Label size={20} weight="semibold">{state.transactions.length ? 'No matching transfers' : 'Your story starts here'}</Label><Note>{filter === 'Received' ? 'This preview simulates outgoing transfers only.' : 'Your approved demo transfers appear here.'}</Note><Button label="Make a demo transfer" onPress={() => router.push('/send')} /></Card> : <Card>{transactions.map(tx => <Pressable key={tx.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} style={[shared.row, { minHeight: 76 }]}><WallyAsset name="690ea.svg" /><View style={shared.flex}><Label numberOfLines={1}>To {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label><Label size={12} color={c.muted}>{tx.status} · Arbitrum</Label></View><View style={{ alignItems: 'flex-end' }}><Label>−{tx.amount} USDt</Label><Label size={12} color={c.muted}>{new Date(tx.submittedAt).toLocaleDateString()}</Label></View></Pressable>)}</Card>}
    <Note>Personal wallet · Simulated transfers · Saved on this device</Note>
  </Screen>;
}

const s = StyleSheet.create({
  illustration: { width: 300, maxWidth: '100%', height: 244, borderRadius: 40, backgroundColor: c.tint, alignSelf: 'center', marginTop: 26, marginBottom: 12 },
  illustratedWallet: { position: 'absolute', top: 39, left: 32, width: 228, height: 146, borderRadius: 24, backgroundColor: c.brand, paddingHorizontal: 20, paddingTop: 15 },
  bubble: { position: 'absolute', right: 15, bottom: 32, width: 202, minHeight: 70, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  balanceCaption: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: '#FFFFFF29', marginTop: 22 },
  networkPill: { backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  asset: { minHeight: 65, backgroundColor: c.surface, borderRadius: 20, paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
  assetIcon: { width: 40, height: 40, backgroundColor: c.tint, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  ask: { flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: c.tint, borderRadius: 18, paddingHorizontal: 14, minHeight: 44, marginTop: 6 },
});
