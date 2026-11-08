import React, { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Label, Note, shared } from './ui';
import { WallyAsset } from './WallyAsset';
import { useDemo } from '../demo/store';
import { money, units } from '../demo/model';
import { colors as c, fonts } from '../theme';

/** Figma chat/history-panel populated from device records. */
export function ChatHistoryPanel({ height, onClose }: { height: number; onClose: () => void }) {
  const { state } = useDemo();
  const [tab, setTab] = useState<'Chats' | 'Transactions'>('Chats');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(5);
  const term = search.toLowerCase();
  const chats = state.chats.filter(chat => (chat.title + chat.messages.map(message => message.text).join(' ')).toLowerCase().includes(term));
  const transactions = state.transactions.filter(tx => (tx.amount + tx.recipient + tx.status).toLowerCase().includes(term));
  const count = tab === 'Chats' ? chats.length : transactions.length;
  return <View style={{ paddingHorizontal: 28 }}><View style={{ alignSelf: 'flex-end', width: '100%', maxWidth: 384, maxHeight: Math.max(180, Math.min(500, height)), backgroundColor: c.background, borderWidth: 1, borderColor: c.line, borderRadius: 24, padding: 16, gap: 12, boxShadow: '0 10px 25px #1F292414' }}>
    <View style={[shared.row, { gap: 8 }]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search chat history" placeholder={tab === 'Chats' ? 'Search chats' : 'Search transactions'} placeholderTextColor={c.muted} value={search} onChangeText={text => { setSearch(text); setLimit(5); }} style={{ flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, fontFamily: fonts.regular, color: c.ink }} />{!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear history search" onPress={() => setSearch('')} style={{ padding: 8 }}><Label size={12}>Clear</Label></Pressable>}<Pressable accessibilityRole="button" accessibilityLabel="Close chat history" onPress={onClose} style={{ padding: 8 }}><WallyAsset name="9e528.svg" /></Pressable></View>
    <View style={{ flexDirection: 'row', backgroundColor: c.toggle, padding: 4, borderRadius: 28 }}>{(['Chats', 'Transactions'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: value === tab }} onPress={() => { setTab(value); setLimit(5); }} style={{ flex: 1, paddingVertical: 10, borderRadius: 24, backgroundColor: value === tab ? c.surface : undefined }}><Label size={14} weight={value === tab ? 'semibold' : 'regular'} style={shared.center}>{value}</Label></Pressable>)}</View>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }}><Note>{tab === 'Chats' ? 'RECENT CONVERSATIONS' : 'RECENT TRANSACTIONS'}</Note>
      {tab === 'Chats' ? chats.slice(0, limit).map(chat => <Pressable key={chat.id} accessibilityRole="button" onPress={() => { onClose(); router.replace({ pathname: '/chat', params: { id: chat.id } }); }} style={[shared.row, { alignItems: 'flex-start', paddingVertical: 16, minHeight: 76, borderBottomWidth: 1, borderColor: c.line }]}><WallyAsset name={chat.messages.some(message => message.draft) ? '690ea.svg' : 'c0ea4.svg'} /><View style={shared.flex}><Label size={16} weight="semibold" numberOfLines={2}>{chat.title}</Label><Label size={13} color={c.muted}>{chat.messages.length} messages · Saved locally</Label></View></Pressable>) : transactions.slice(0, limit).map(tx => <Pressable key={tx.id} accessibilityRole="button" onPress={() => { onClose(); router.push({ pathname: '/transaction', params: { id: tx.id } }); }} style={[shared.row, { paddingVertical: 16, minHeight: 76, borderBottomWidth: 1, borderColor: c.line }]}><WallyAsset name="690ea.svg" /><View style={shared.flex}><Label size={16} weight="semibold">Sent to {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label><Label size={13} color={c.muted}>{money(units(tx.amount) ?? 0)} USDt · {tx.status}</Label></View></Pressable>)}
      {!count && <Note>No matching {tab.toLowerCase()} on this device.</Note>}{count > limit && <Button secondary label="Load older" onPress={() => setLimit(limit + 5)} />}
    </ScrollView>
  </View></View>;
}
