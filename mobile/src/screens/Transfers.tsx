import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Share, TextInput, View } from 'react-native';
import { WallyAsset } from '../components/WallyAsset';
import { Address, Button, Card, Detail, Divider, Icon, Label, Note, Pill, QrTile, ReceiveAddress, Screen, shared } from '../components/ui';
import { DEMO_ADDRESS, DEMO_RECIPIENT, FEE, money, units } from '../demo/model';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveReceiveScreen, LiveReviewScreen, LiveSendScreen, LiveTransactionScreen } from './LiveWallet';

export function SendScreen() { return useWallet().enabled ? <LiveSendScreen /> : <DemoSendScreen />; }
function DemoSendScreen() {
  const { state, draft, setDraft, prepare } = useDemo();
  const [error, setError] = useState('');
  function review() {
    const failure = prepare({ recipient: draft.recipient.trim(), amount: draft.amount.trim() });
    if (failure) { setError(failure); return; }
    setError(''); router.push('/review');
  }
  return <Screen title="Send" subtitle="Arbitrum · Demo transfer" footer={<><Button label="Review transfer" onPress={review} disabled={state.offline} /><Button secondary label="Cancel" onPress={() => router.replace('/wallet')} /></>}>
    <Pill>Available: {money(state.balance)} USDT</Pill>
    {state.offline && <Note error>You’re offline. You can edit your draft, but reconnect in Settings before reviewing.</Note>}
    <Label size={12} weight="medium" color={c.muted}>RECIPIENT</Label>
    <TextInput accessibilityLabel="Recipient address" autoCapitalize="none" autoCorrect={false} value={draft.recipient} onChangeText={recipient => { setDraft({ ...draft, recipient }); setError(''); }} maxLength={100} placeholder="0x…" placeholderTextColor={c.muted} multiline style={[shared.input, { minHeight: 92, textAlignVertical: 'top' }]} />
    <Button secondary label="Choose saved recipient" onPress={() => router.push('/address-book')} />
    <Label size={12} weight="medium" color={c.muted}>AMOUNT</Label>
    <View style={[shared.row, { backgroundColor: c.surface, borderRadius: 20, paddingHorizontal: 16, minHeight: 84 }]}>
      <TextInput accessibilityLabel="Amount in USDT" keyboardType="decimal-pad" value={draft.amount} onChangeText={amount => { setDraft({ ...draft, amount }); setError(''); }} maxLength={18} placeholder="0.00" placeholderTextColor={c.muted} style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 28, color: c.ink, paddingVertical: 18 }} />
      <Label weight="medium" color={c.muted}>USDT</Label>
    </View>
    <Card><Label size={12} color={c.muted}>NETWORK</Label><Label size={16}>Arbitrum · Demo</Label></Card>
    <Note>A sample fee is shown before you review. Sending always needs approval.</Note>
    {error ? <Note error>{error}</Note> : null}
    <Button label="Use sample details" secondary onPress={() => { setDraft({ recipient: DEMO_RECIPIENT, amount: '25' }); setError(''); }} />
  </Screen>;
}

export function ReviewScreen() { return useWallet().enabled ? <LiveReviewScreen /> : <DemoReviewScreen />; }
function DemoReviewScreen() {
  const { quote, draft, state, prepare, confirm, cancel } = useDemo();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  const expired = !quote || now >= quote.expiresAt;
  const details = quote ?? draft;
  const amount = units(details.amount) ?? 0;
  const remaining = quote ? Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)) : 0;
  function refresh() { const failure = prepare(draft); setError(failure ?? ''); setNow(Date.now()); }
  function send() {
    const result = confirm();
    if (result.error) setError(result.error);
    else router.replace({ pathname: '/transaction', params: { id: result.id! } });
  }
  function leave() { cancel(); router.replace('/send'); }
  return <Screen title="Review transfer" subtitle={expired ? 'This quote is no longer valid' : 'Check every detail before you send'} footer={<>
    <Button label={expired ? 'Get a new quote' : `Confirm & send ${money(amount)} USDT`} disabled={state.offline} onPress={expired ? refresh : send} />
    <Button label={expired ? 'Back to draft' : 'Cancel transfer'} secondary onPress={leave} />
  </>}>
    {expired ? <>
      <View style={[shared.orb, { marginTop: 34, backgroundColor: c.warningTint }]}><Icon name="expired" /></View>
      <Label size={24} weight="semibold" style={[shared.center, { marginTop: 14 }]}>Your quote expired</Label>
      <Label size={16} weight="medium" style={shared.center}>Nothing was sent.</Label>
      <Label color={c.muted} style={[shared.center, { marginTop: 8 }]}>Network fees can change. Get a fresh quote, then review the details again.</Label>
      <Card style={{ marginTop: 26 }}><Note>Your draft is still here</Note><Label size={18} weight="semibold">{money(amount)} USDT · Arbitrum</Label><Label size={11} color={c.muted}>Recipient unchanged · Fee needs updating</Label></Card>
    </> : <>
      <Label size={12} color={c.orange}>DEMO · ARBITRUM</Label>
      <Label size={28} weight="semibold">Review this transfer.</Label><Label size={16} color={c.muted}>Check the address and fee before approving.</Label>
      <Pill tone="warning">FEE QUOTE · {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</Pill>
      <Card style={{ gap: 12 }}><Label size={12} color={c.muted}>YOU SEND</Label><Label size={28} weight="semibold" adjustsFontSizeToFit numberOfLines={1}>{money(amount)} USDt</Label><Divider /><Detail label="FROM" value="Personal wallet" /><Label size={12} color={c.muted}>TO · FULL ADDRESS</Label><Address value={details.recipient} /><Divider /><Detail label="NETWORK" value="Arbitrum · Demo" /><Divider /><Detail label="ESTIMATED FEE" value="0.02 USDt" /><Divider /><Detail label="TOTAL DEBIT" value={`${money(amount + FEE)} USDt`} emphasis /><Divider /><Note>Check the full address. This quote expires after {state.quoteSeconds} seconds.</Note></Card>
      <Card style={{ backgroundColor: c.successTint }}><Label size={18} weight="bold">Estimated balance after sending</Label><Detail label="Available on Arbitrum" value={`${money(state.balance)} USDt`} /><Detail label="Total debit" value={`${money(amount + FEE)} USDt`} /><Detail label="After transfer" value={`${money(state.balance - amount - FEE)} USDt`} /></Card>
      <Note>Nothing has been sent yet. This is a simulated transfer.</Note>
    </>}
    {state.offline && <Note error>Reconnect in Settings, then request a new quote.</Note>}
    {error ? <Note error>{error}</Note> : null}
  </Screen>;
}

export function TransactionScreen() { const params = useLocalSearchParams<{ hash?: string }>(); return useWallet().enabled && params.hash ? <LiveTransactionScreen /> : <DemoTransactionScreen />; }
function DemoTransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, setDraft } = useDemo();
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return <Screen title="Transfer not found"><Note>This preview transaction is no longer available.</Note><Button label="Back to wallet" onPress={() => router.replace('/wallet')} /></Screen>;
  const pending = tx.status === 'pending';
  const failed = tx.status === 'failed';
  const amount = money(units(tx.amount) ?? 0);
  return <Screen title={pending ? 'Sending transfer' : failed ? 'Transfer failed' : 'Transfer complete'} subtitle="Arbitrum · Demo transaction" footer={<>
    {failed && <Button label="Review a new attempt" onPress={() => { setDraft({ recipient: tx.recipient, amount: tx.amount }); router.replace('/send'); }} />}
    <Button label={pending || failed ? 'Back to wallet' : 'Done'} secondary={pending || failed} onPress={() => router.replace('/wallet')} />
    <Label size={10} color={c.muted} style={shared.center}>{pending ? 'You can leave this screen safely.' : 'Illustrative receipt · no transaction was sent'}</Label>
  </>}>
    <View style={[shared.orb, { marginTop: 20, backgroundColor: pending ? c.tint : failed ? c.warningTint : c.successTint }]}><Icon name={pending ? 'clock' : failed ? 'expired' : 'confirmed'} /></View>
    <Label size={24} weight="semibold" style={[shared.center, { marginTop: 16 }]}>{pending ? 'Waiting for the network' : failed ? 'Let’s try that again' : 'Sent. And confirmed.'}</Label>
    <Label size={pending ? 18 : 32} weight="semibold" color={pending ? c.brand : c.ink} style={shared.center}>{amount} USDT</Label>
    {pending ? <>
      <Label color={c.muted} style={[shared.center, { marginVertical: 8 }]}>Your demo transfer was submitted.{'\n'}Simulating network confirmation…</Label>
      <Card style={{ gap: 22, marginTop: 12 }}>{[['check', 'Approved by you'], ['check', 'Submitted to Arbitrum (demo)'], ['clockSmall', 'Waiting for confirmation']].map(([icon, text]) => <View key={text} style={shared.row}><Icon name={icon as 'check' | 'clockSmall'} /><Label weight="medium" color={icon === 'clockSmall' ? c.brand : c.ink} style={shared.flex}>{text}</Label></View>)}</Card>
    </> : failed ? <><Label color={c.muted} style={shared.center}>The simulated network rejected this transfer. Your demo amount and fee have been returned.</Label><Card><Note>Recipient</Note><Address value={tx.recipient} /><Detail label="Refunded" value={`${money((units(tx.amount) ?? 0) + FEE)} USDT`} /></Card></> : <>
      <View style={{ alignItems: 'center', marginVertical: 8 }}><Pill tone="success">Confirmed on Arbitrum · Demo</Pill></View>
      <Card style={{ marginTop: 12 }}><Note>To</Note><Address value={tx.recipient} /><Divider /><Detail label="Network fee" value="0.02 USDT" /><Label size={11} color={c.success}>Simulated confirmation · {new Date(tx.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Label></Card>
    </>}
  </Screen>;
}

export function ReceiveScreen() { return useWallet().enabled ? <LiveReceiveScreen /> : <DemoReceiveScreen />; }
function DemoReceiveScreen() {
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { const result = await Clipboard.setStringAsync(DEMO_ADDRESS); setCopied(result); setMessage(result ? 'Sample address copied.' : 'Copy was unavailable. Share the address instead.'); }
    catch { setMessage('Copy was unavailable. Share the address instead.'); }
  }
  return <Screen title="Receive" footer={<Button secondary label="Close" onPress={() => router.replace('/wallet')} />}>
    <Card><Label size={18} weight="bold">Receive USDt</Label><Note>Arbitrum · Demo address</Note><QrTile><WallyAsset name="eab8b.svg" /></QrTile><ReceiveAddress value={DEMO_ADDRESS} onCopy={() => { void copy(); }} /><View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} onPress={copy} style={shared.flex} /><Button accent label="Share" style={shared.flex} onPress={() => { void Share.share({ message: `Wally preview address (fictional; do not fund): ${DEMO_ADDRESS}` }).catch(() => setMessage('Sharing is unavailable on this device.')); }} /></View><Note>Preview address only. Do not send real funds.</Note></Card>
    {message ? <Label size={12} color={copied ? c.success : c.error} accessibilityLiveRegion="polite" style={shared.center}>{message}</Label> : null}
  </Screen>;
}
