import React, { useState } from 'react';
import { router } from 'expo-router';
import { TextInput, View } from 'react-native';
import { Avatar, WallyAsset } from '../components/WallyAsset';
import { Address, Button, Card, Group, Label, Note, Row, Screen, shared } from '../components/ui';
import { CurrencyChoice } from '../components/ChatCards';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';
import { useWallet } from '../data/wallet';

export function ProfileScreen() {
  const { preferences, updatePreferences, error } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(preferences.name);
  return <Screen title="Profile">
    <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}><Avatar /><Label size={25} weight="semibold">{preferences.name}</Label></View>
    {editing
      ? <Card><TextInput accessibilityLabel="Display name" placeholder="Display name" placeholderTextColor={c.muted} value={name} onChangeText={setName} maxLength={40} autoFocus style={[shared.input, { backgroundColor: c.background }]} /><Button label="Save" disabled={!name.trim()} onPress={() => { updatePreferences({ name: name.trim() }); setEditing(false); }} /><Button secondary label="Cancel" onPress={() => setEditing(false)} /></Card>
      : <Button secondary label="Edit name" onPress={() => { setName(preferences.name); setEditing(true); }} />}
    <CurrencyChoice />
    <Group><Row title="Address book" onPress={() => router.push('/address-book')} /></Group>
    {!!error && <Note error>{error}</Note>}
  </Screen>;
}

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

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
  // The demo only simulates Arbitrum USDt, so a recipient on another network simply has no send button.
  const sendable = !!recipient && (wallet.enabled || recipient.network === 'Arbitrum');
  function save() {
    if (!name.trim() || !/^0x[\da-fA-F]{40}$/.test(address.trim()) || /^0x0{40}$/.test(address.trim())) { setError('Enter a name and a complete, non-zero EVM address.'); return; }
    const existing = preferences.recipients.find(item => item.id === editing);
    const next = { id: existing?.id ?? `recipient-${Date.now()}`, name: name.trim(), address: address.trim(), network: existing?.network ?? 'Arbitrum' as const };
    updatePreferences({ recipients: [...preferences.recipients.filter(item => item.id !== editing), next] });
    setEditing(null); setSelected(next.id); setError('');
  }
  const matches = preferences.recipients.filter(item => (item.name + item.address).toLowerCase().includes(search.toLowerCase()));
  return <Screen title="Address book">
    <View style={[shared.row, shared.input]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search recipients" value={search} onChangeText={setSearch} placeholder="Search" placeholderTextColor={c.muted} style={{ flex: 1, fontFamily: fonts.regular, color: c.ink, fontSize: 16 }} /></View>
    <Group>{matches.map(item => <Row key={item.id} title={item.name} value={short(item.address)} onPress={() => { setSelected(item.id); setEditing(null); }} />)}</Group>
    {recipient && editing === null && <Card>
      <Label size={18} weight="semibold">{recipient.name}</Label>
      <Address value={recipient.address} />
      <Label size={13} color={c.muted}>{recipient.network}</Label>
      {sendable && <Button label="Send" onPress={() => { if (wallet.enabled) { router.push({ pathname: '/send', params: { recipient: recipient.address, chain: recipient.network === 'Ethereum' ? 'ethereum' : 'arbitrum' } }); return; } setDraft({ ...draft, recipient: recipient.address }); router.push('/send'); }} />}
      <View style={shared.row}>
        <Button secondary label="Edit" style={shared.flex} onPress={() => { setEditing(recipient.id); setName(recipient.name); setAddress(recipient.address); setError(''); }} />
        <Button secondary label="Remove" style={shared.flex} onPress={() => { updatePreferences({ recipients: preferences.recipients.filter(item => item.id !== recipient.id) }); setSelected(null); }} />
      </View>
    </Card>}
    {editing !== null && <Card>
      <TextInput accessibilityLabel="Recipient name" placeholder="Name" placeholderTextColor={c.muted} value={name} onChangeText={setName} maxLength={40} style={[shared.input, { backgroundColor: c.background }]} />
      <TextInput accessibilityLabel="Saved recipient address" placeholder="0x… address" placeholderTextColor={c.muted} value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} maxLength={42} style={[shared.input, { backgroundColor: c.background }]} />
      <Button label="Save" onPress={save} />
      <Button secondary label="Cancel" onPress={() => setEditing(null)} />
    </Card>}
    {!!error && <Note error>{error}</Note>}{!!storageError && <Note error>{storageError}</Note>}
    {editing === null && <Button secondary label="Add recipient" onPress={() => { setEditing('new'); setName(''); setAddress(''); setError(''); }} />}
  </Screen>;
}
