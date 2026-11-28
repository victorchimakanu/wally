import { CustodyGuard } from '../components/WalletData';
import React, { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Share, TextInput, View } from 'react-native';
import { WallyAsset } from '../components/WallyAsset';
import { Address, Button, Card, Detail, Divider, Group, Icon, Label, LinkButton, Note, Pill, QrTile, ReceiveAddress, Row, Screen, useShared } from '../components/ui';
import { DEMO_ADDRESS, DEMO_RECIPIENT, FEE, money, units } from '../demo/model';
import { useDemo } from '../demo/store';
import { fonts, useColors } from '../theme';
import { useWallet } from '../data/wallet';
import { LiveReceiveScreen, LiveReviewScreen, LiveSendScreen, LiveTransactionScreen } from './LiveWallet';

export function SendScreen() {
  const wallet = useWallet();
  // Refuse before choosing. Falling through to the demo screen would be safe but silent, and
  // a user who cannot send deserves to know it is custody and not a bug.
  if (wallet.blocked) return <Screen title="Send"><CustodyGuard /></Screen>;
  return wallet.enabled ? <LiveSendScreen /> : <DemoSendScreen />;
}
function DemoSendScreen() {
  const c = useColors();
  const shared = useShared();
  const { state, draft, setDraft, prepare } = useDemo();
  const [error, setError] = useState('');
  function review() {
    const failure = prepare({ recipient: draft.recipient.trim(), amount: draft.amount.trim() });
    if (failure) { setError(failure); return; }
    setError(''); router.push('/review');
  }
  return <Screen title="Send" footer={<Button label="Review transfer" onPress={review} disabled={state.offline} />}>
    {state.offline && <Note error>You’re offline. Reconnect to review.</Note>}
    <View style={{ gap: 8 }}>
      <View style={[shared.row, { gap: 20 }]}><Label size={13} weight="medium" color={c.muted} style={shared.flex}>To</Label><LinkButton label="Saved" accessibilityLabel="Choose saved recipient" onPress={() => router.push('/address-book')} /><LinkButton label="Sample" accessibilityLabel="Use sample details" onPress={() => { setDraft({ recipient: DEMO_RECIPIENT, amount: '25' }); setError(''); }} /></View>
      <TextInput accessibilityLabel="Recipient address" autoCapitalize="none" autoCorrect={false} value={draft.recipient} onChangeText={recipient => { setDraft({ ...draft, recipient }); setError(''); }} maxLength={100} placeholder="0x…" placeholderTextColor={c.muted} multiline style={[shared.input, { minHeight: 92, textAlignVertical: 'top' }]} />
    </View>
    <View style={{ gap: 8 }}>
      <View style={shared.between}><Label size={13} weight="medium" color={c.muted}>Amount</Label><Label size={13} color={c.muted}>{money(state.balance)} USDt available</Label></View>
      <View style={[shared.row, { backgroundColor: c.surface, borderRadius: 20, paddingHorizontal: 16, minHeight: 84 }]}>
        <TextInput accessibilityLabel="Amount in USDT" keyboardType="decimal-pad" value={draft.amount} onChangeText={amount => { setDraft({ ...draft, amount }); setError(''); }} maxLength={18} placeholder="0.00" placeholderTextColor={c.muted} style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 28, color: c.ink, paddingVertical: 18 }} />
        <Label weight="medium" color={c.muted}>USDt</Label>
      </View>
    </View>
    <Group><Row title="Network" value="Arbitrum · Demo" /></Group>
    {error ? <Note error>{error}</Note> : null}
  </Screen>;
}

export function ReviewScreen() { return useWallet().enabled ? <LiveReviewScreen /> : <DemoReviewScreen />; }
function DemoReviewScreen() {
  const c = useColors();
  const shared = useShared();
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
  // Everything that decides whether to approve is on this one card, and the button repeats the
  // amount, so the confirm step needs no paragraph telling you to check it.
  return <Screen title="Review" footer={<>
    <Button label={expired ? 'Get a new quote' : `Send ${money(amount)} USDt`} disabled={state.offline} onPress={expired ? refresh : send} />
    <Button label="Cancel" secondary onPress={leave} />
  </>}>
    {expired ? <>
      <View style={[shared.orb, { marginTop: 34, backgroundColor: c.warningTint }]}><Icon name="expired" /></View>
      <Label size={24} weight="semibold" style={[shared.center, { marginTop: 14 }]}>Quote expired</Label>
      <Label size={16} color={c.muted} style={shared.center}>Nothing was sent.</Label>
    </> : <>
      <View style={shared.between}>
        <Label size={32} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ flexShrink: 1, lineHeight: 40 }}>{money(amount)} USDt</Label>
        <Pill tone="warning">Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</Pill>
      </View>
      <Card style={{ gap: 12 }}>
        <Label size={13} color={c.muted}>To</Label><Address value={details.recipient} />
        <Divider />
        <Detail label="Network" value="Arbitrum · Demo" />
        <Detail label="Fee" value="0.02 USDt" />
        <Detail label="Total" value={`${money(amount + FEE)} USDt`} emphasis />
        <Detail label="Balance after" value={`${money(state.balance - amount - FEE)} USDt`} />
      </Card>
    </>}
    {state.offline && <Note error>Reconnect, then get a new quote.</Note>}
    {error ? <Note error>{error}</Note> : null}
  </Screen>;
}

export function TransactionScreen() { const params = useLocalSearchParams<{ hash?: string }>(); return useWallet().enabled && params.hash ? <LiveTransactionScreen /> : <DemoTransactionScreen />; }
function DemoTransactionScreen() {
  const c = useColors();
  const shared = useShared();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, setDraft } = useDemo();
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return <Screen title="Transfer"><Note>This transfer is no longer available.</Note><Button label="Back to wallet" onPress={() => router.replace('/wallet')} /></Screen>;
  const pending = tx.status === 'pending';
  const failed = tx.status === 'failed';
  const amount = money(units(tx.amount) ?? 0);
  return <Screen title="Transfer" footer={<>
    {failed && <Button label="Try again" onPress={() => { setDraft({ recipient: tx.recipient, amount: tx.amount }); router.replace('/send'); }} />}
    <Button label="Done" secondary={failed} onPress={() => router.replace('/wallet')} />
  </>}>
    <View style={[shared.orb, { marginTop: 20, backgroundColor: pending ? c.tint : failed ? c.warningTint : c.successTint }]}><Icon name={pending ? 'clock' : failed ? 'expired' : 'confirmed'} /></View>
    <Label size={18} weight="medium" color={pending ? c.brand : failed ? c.error : c.success} style={[shared.center, { marginTop: 16 }]}>{pending ? 'Sending' : failed ? 'Failed' : 'Sent'}</Label>
    <Label size={32} weight="semibold" style={shared.center}>{amount} USDt</Label>
    {pending
      ? <Card style={{ gap: 22, marginTop: 12 }}>{[['check', 'Approved by you'], ['check', 'Submitted (demo)'], ['clockSmall', 'Waiting for confirmation']].map(([icon, text]) => <View key={text} style={shared.row}><Icon name={icon as 'check' | 'clockSmall'} /><Label weight="medium" color={icon === 'clockSmall' ? c.brand : c.ink} style={shared.flex}>{text}</Label></View>)}</Card>
      : <Card style={{ marginTop: 12 }}>
        <Label size={13} color={c.muted}>To</Label><Address value={tx.recipient} />
        <Divider />
        {failed
          ? <Detail label="Refunded" value={`${money((units(tx.amount) ?? 0) + FEE)} USDt`} />
          : <><Detail label="Network" value="Arbitrum · Demo" /><Detail label="Fee" value="0.02 USDt" /><Detail label="Time" value={new Date(tx.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} /></>}
      </Card>}
  </Screen>;
}

export function ReceiveScreen() {
  const wallet = useWallet();
  // The most important refusal in the app. An address on screen is an invitation to send funds
  // to it, and in a split it belongs to a wallet the user's phrase cannot recover.
  if (wallet.blocked) return <Screen title="Receive"><CustodyGuard /></Screen>;
  return wallet.enabled ? <LiveReceiveScreen /> : <DemoReceiveScreen />;
}
function DemoReceiveScreen() {
  const shared = useShared();
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { const result = await Clipboard.setStringAsync(DEMO_ADDRESS); setCopied(result); setMessage(result ? '' : 'Copy was unavailable. Share the address instead.'); }
    catch { setMessage('Copy was unavailable. Share the address instead.'); }
  }
  // The address is fictional, so the warning not to fund it sits beside the title, not under the buttons.
  return <Screen title="Receive">
    <Card>
      <View style={shared.between}><Label size={18} weight="bold">USDt · Arbitrum</Label><Pill tone="warning">Demo · do not fund</Pill></View>
      <QrTile><WallyAsset name="eab8b.svg" tint={false} /></QrTile>
      <ReceiveAddress value={DEMO_ADDRESS} onCopy={() => { void copy(); }} />
      <View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} onPress={copy} style={shared.flex} /><Button accent label="Share" style={shared.flex} onPress={() => { void Share.share({ message: `Wally preview address (fictional; do not fund): ${DEMO_ADDRESS}` }).catch(() => setMessage('Sharing is unavailable on this device.')); }} /></View>
    </Card>
    {message ? <Note error>{message}</Note> : null}
  </Screen>;
}
