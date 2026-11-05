import React, { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, TextInput, View } from 'react-native';
import { Avatar, WallyAsset, type AssetName } from '../components/WallyAsset';
import { Address, Button, Card, Label, Note, Screen, shared } from '../components/ui';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';
import { useWallet } from '../data/wallet';

export function SettingRow({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: AssetName; onPress?: () => void }) {
  const content = <><WallyAsset name={icon} /><View style={shared.flex}><Label size={16}>{title}</Label><Label size={12} color={c.muted}>{subtitle}</Label></View>{onPress && <WallyAsset name="afc43.svg" />}</>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={[shared.row, { minHeight: 72 }]}>{content}</Pressable> : <View style={[shared.row, { minHeight: 72 }]}>{content}</View>;
}
export function ProfileScreen() {
  const { preferences, updatePreferences, error } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [currency, setCurrency] = useState(false);
  const [name, setName] = useState(preferences.name);
  return <Screen title="Profile">
    <View style={{ backgroundColor: c.tint, borderRadius: 24, padding: 24, alignItems: 'center', gap: 12 }}><Avatar /><Label size={25} weight="semibold">{preferences.name}</Label><Label size={14} color={c.muted}>Personal wallet</Label></View>
    {editing ? <Card><Label size={12} color={c.muted}>Display name</Label><TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} maxLength={40} style={shared.input} /><Button label="Save changes" disabled={!name.trim()} onPress={() => { updatePreferences({ name: name.trim() }); setEditing(false); }} /><Button secondary label="Cancel editing" onPress={() => setEditing(false)} /></Card> : <Button secondary label="Edit profile" onPress={() => { setName(preferences.name); setEditing(true); }} />}
    <View style={{ gap: 6 }}><SettingRow title="Local currency" subtitle={preferences.currency} icon="de282.svg" onPress={() => setCurrency(!currency)} />
      {currency && <Card>{['USD', 'NGN', 'EUR'].map(value => <Button key={value} secondary label={(preferences.currency === value ? 'Selected · ' : '') + value} onPress={() => { updatePreferences({ currency: value }); setCurrency(false); }} />)}<Note>Market prices and charts refresh in the selected currency. Wallet token quantities do not change.</Note></Card>}
      <SettingRow title="Address book" subtitle="Your saved recipients" icon="9a2cd.svg" onPress={() => router.push('/address-book')} />
      <SettingRow title="App security" subtitle="Wallet setup guidance" icon="43454.svg" onPress={() => router.push({ pathname: '/preferences', params: { panel: 'security' } })} />
      <SettingRow title="Settings" subtitle="Networks, assistant and recovery" icon="f2470.svg" onPress={() => router.push('/settings')} />
    </View>
    <Note>Profile details are saved on this device.</Note>{!!error && <Note error>{error}</Note>}
  </Screen>;
}
export function AddressBookScreen() {
  const wallet = useWallet();
  const { preferences, updatePreferences, error: storageError } = usePreferences();
  const { setDraft, draft } = useDemo();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const recipient = preferences.recipients.find(item => item.id === selected);
  function save() {
    if (!name.trim() || !/^0x[\da-fA-F]{40}$/.test(address.trim()) || /^0x0{40}$/.test(address.trim())) { setError('Enter a name and a complete, non-zero EVM address.'); return; }
    const existing = preferences.recipients.find(item => item.id === editing);
    const next = { id: existing?.id ?? `recipient-${Date.now()}`, name: name.trim(), address: address.trim(), network: existing?.network ?? 'Arbitrum' as const };
    updatePreferences({ recipients: [...preferences.recipients.filter(item => item.id !== editing), next] });
    setEditing(null); setSelected(next.id); setError('');
  }
  return <Screen title="Address book">
    <View style={[shared.row, shared.input]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search recipients" value={search} onChangeText={setSearch} placeholder="Search recipients" placeholderTextColor={c.muted} style={{ flex: 1, fontFamily: fonts.regular, color: c.ink, fontSize: 16 }} /></View>
    {preferences.recipients.filter(item => (item.name + item.address).toLowerCase().includes(search.toLowerCase())).map(item => <SettingRow key={item.id} title={item.name} subtitle={`${item.address.slice(0, 6)}…${item.address.slice(-4)} · ${item.network}`} icon="99b43.svg" onPress={() => { setSelected(item.id); setEditing(null); }} />)}
    {recipient && editing === null && <Card><Label size={18} weight="bold">{recipient.name}</Label><Address value={recipient.address} /><Note>{recipient.network} · Saved recipient</Note><Button label="Use in manual send" disabled={!wallet.enabled && recipient.network !== 'Arbitrum'} onPress={() => { if (wallet.enabled) { router.push({ pathname: '/send', params: { recipient: recipient.address, chain: recipient.network === 'Ethereum' ? 'ethereum' : 'arbitrum' } }); return; } setDraft({ ...draft, recipient: recipient.address }); router.push('/send'); }} />{!wallet.enabled && recipient.network !== 'Arbitrum' && <Note>Sending is simulated for Arbitrum USDt only.</Note>}<Button secondary label="Edit recipient" onPress={() => { setEditing(recipient.id); setName(recipient.name); setAddress(recipient.address); setError(''); }} /><Button secondary label="Remove recipient" onPress={() => { updatePreferences({ recipients: preferences.recipients.filter(item => item.id !== recipient.id) }); setSelected(null); }} /></Card>}
    {editing !== null && <Card><Label size={18} weight="bold">{editing === 'new' ? 'Add recipient' : 'Edit recipient'}</Label><Label size={12} color={c.muted}>Name</Label><TextInput accessibilityLabel="Recipient name" value={name} onChangeText={setName} maxLength={40} style={shared.input} /><Label size={12} color={c.muted}>EVM address</Label><TextInput accessibilityLabel="Saved recipient address" value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} maxLength={42} style={shared.input} /><Button label="Save recipient" onPress={save} /><Button secondary label="Cancel editing" onPress={() => setEditing(null)} /></Card>}
    {!!error && <Note error>{error}</Note>}{!!storageError && <Note error>{storageError}</Note>}
    <Button secondary label="Add recipient" onPress={() => { setEditing('new'); setName(''); setAddress(''); setError(''); }} />
    <Note>Saved locally. The initial recipients are fictional sample addresses.</Note>
  </Screen>;
}
