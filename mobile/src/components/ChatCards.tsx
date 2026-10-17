import React, { useState } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Modal, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { Address, Button, Card, Detail, Divider, Label, Note, QrTile, ReceiveAddress, shared } from './ui';
import { WallyAsset } from './WallyAsset';
import { WalletOverview } from './WalletOverview';
import { AssetLogo, AssetRow } from './MarketRows';
import { useMarket } from '../data/market';
import { MarketStatus } from './MarketData';
import { COINS, formatChange, formatPrice } from '../services/market-api';
import { DEMO_ADDRESS, FEE, draftStatus, money, units, type ChatTool, type Draft, type Message, type Quote, type Transaction } from '../demo/model';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { colors as c } from '../theme';
import { LiveActivityCard, LiveReceiveCard, LiveWalletOverview } from './WalletData';

function Field({ label, value }: { label: string; value: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><Label size={12} color={c.muted} style={{ width: '31%', lineHeight: 17 }}>{label}</Label><Label size={12} weight="medium" style={{ flex: 1, textAlign: 'right', lineHeight: 17 }}>{value}</Label></View>;
}
export function ToolStateCard({ kind, detail, onAction }: { kind: 'unavailable' | 'timeout' | 'stopped' | 'expired' | 'insufficient' | 'blocked'; detail?: string; onAction?: () => void }) {
  const copy = {
    unavailable: ['Wally is unavailable', 'Use the wallet tools while the assistant is unavailable.', 'Open wallet'],
    timeout: ['That took too long', 'The request timed out. Your wallet is still available.', 'Try again'],
    stopped: ['Request stopped', 'Nothing was submitted. Your wallet is still available.', 'Continue'],
    expired: ['This quote has expired', 'Refresh the fee before reviewing again. Nothing was sent.', 'Refresh quote'],
    insufficient: ['Not enough USDt', 'Choose a smaller amount or receive USDt into this wallet.', 'Edit amount'],
    blocked: ['This action needs your review', 'Use the wallet controls to check the details. Nothing was sent.', 'Open manual send'],
  }[kind];
  return <Card style={{ gap: 12, backgroundColor: kind === 'expired' || kind === 'insufficient' || kind === 'blocked' ? c.amber : c.surface }}><View style={[shared.row, { alignItems: 'flex-start' }]}><View style={{ width: 24, alignItems: 'center' }}><WallyAsset name={kind === 'unavailable' ? '4ee0b.svg' : ['expired', 'insufficient', 'blocked'].includes(kind) ? '91154.svg' : '8dca8.svg'} /></View><Label size={18} weight="bold" style={{ flex: 1, lineHeight: 22 }}>{copy[0]}</Label></View><Label size={16} color={c.muted} style={{ lineHeight: 23 }}>{detail || copy[1]}</Label>{onAction && <Button secondary label={copy[2]} onPress={onAction} />}</Card>;
}
export function ReceiveChatCard() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function copy() { try { const ok = await Clipboard.setStringAsync(DEMO_ADDRESS); setCopied(ok); setError(ok ? '' : 'Copy is unavailable on this device. Share the address instead.'); } catch { setError('Copy is unavailable on this device. Share the address instead.'); } }
  async function share() { try { await Share.share({ message: `Wally preview address (fictional; do not fund): ${DEMO_ADDRESS}` }); setError(''); } catch { setError('Sharing is unavailable. You can still copy the address.'); } }
  return <Card style={{ gap: 12 }}><Label size={18} weight="bold" style={{ lineHeight: 22 }}>Receive USDt</Label><Note>Arbitrum · Demo address</Note><QrTile><WallyAsset name="eab8b.svg" /></QrTile><ReceiveAddress value={DEMO_ADDRESS} onCopy={() => { void copy(); }} /><View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} onPress={() => { void copy(); }} style={[shared.flex, { paddingHorizontal: 12 }]} /><Button accent label="Share" onPress={() => { void share(); }} style={shared.flex} /></View><Note>Preview address only. Do not send real funds.</Note>{copied && <Label size={12} color={c.success} accessibilityLiveRegion="polite">Address copied</Label>}{!!error && <Note error>{error}</Note>}</Card>;
}
export function TransactionChatCard({ transaction: tx }: { transaction: Transaction }) {
  const pending = tx.status === 'pending', failed = tx.status === 'failed';
  const badge = pending ? 'a6471.svg' : failed ? '68d0f.svg' : 'd5ad6.svg';
  const icon = pending ? 'bfc84.svg' : failed ? '98a2e.svg' : '0c821.svg';
  const line = pending ? '#EEE3CE' : failed ? '#E8CCCC' : '#BFE5C9';
  return <Card style={{ backgroundColor: pending ? '#FFF9EF' : failed ? c.errorTint : '#F0FBF4', borderColor: line, borderRadius: 28, gap: 16 }}>
    <View style={shared.row}><View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><WallyAsset name={badge} style={{ position: 'absolute' }} /><WallyAsset name={icon} /></View><View style={shared.flex}><Label size={19} weight="semibold" style={{ lineHeight: 24 }}>{pending ? 'Pending confirmation' : failed ? 'Transfer failed' : 'Transfer confirmed'}</Label><Label size={13} color={c.muted}>{pending ? 'Simulating network confirmation.' : 'Demo receipt saved on this device.'}</Label></View></View>
    <View style={{ height: 1, backgroundColor: line }} />
    {(['Approved by you', 'Submitted to demo simulation', pending ? 'Waiting for confirmation' : failed ? 'Demo transfer rejected' : 'Confirmed by simulation'] as const).map((label, index) => <View key={label} style={[shared.row, { minHeight: 28 }]}><WallyAsset name={index < 2 ? '70fe0.svg' : pending ? '3fc33.svg' : failed ? '5cfbe.svg' : 'de3bd.svg'} /><Label size={16} weight={index < 2 ? 'semibold' : 'regular'} color={index < 2 ? c.ink : c.muted} style={{ flex: 1, lineHeight: 21 }}>{label}</Label></View>)}
    <View style={{ height: 1, backgroundColor: line }} /><View style={shared.between}><Label size={18} weight="semibold">{money(units(tx.amount) ?? 0)} USDt</Label><Label size={13} color={c.muted} style={{ flexShrink: 1, textAlign: 'right' }}>To {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label></View>
    {pending ? <Note>You can leave this chat safely. Nothing is broadcast.</Note> : <><View style={{ height: 1, backgroundColor: line }} /><Field label={failed ? 'Refunded' : 'Network fee'} value={`${money(failed ? (units(tx.amount) ?? 0) + FEE : FEE)} USDt`} /><Field label="Saved time" value={new Date(tx.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} /></>}
    <Button secondary label="Open receipt" onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} />
  </Card>;
}
export function DraftChatCard({ message, quote, now, editRequest = 0, onReview, onCancelReview, onConfirm, onEdit }: { message: Message; quote: Quote | null; now: number; editRequest?: number; onReview: () => void; onCancelReview: () => void; onConfirm: () => void; onEdit: (draft: Draft) => string | null }) {
  const { state } = useDemo();
  const { preferences } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [dismissedEditRequest, setDismissedEditRequest] = useState(0);
  const [edited, setEdited] = useState(message.draft!);
  const [error, setError] = useState('');
  const isEditing = editing || editRequest > dismissedEditRequest;
  const draft = message.draft!, status = draftStatus(message);
  const recipient = preferences.recipients.find(item => item.address.toLowerCase() === draft.recipient.toLowerCase());
  const transaction = state.transactions.find(item => item.id === message.transactionId);
  const expired = !!quote && now >= quote.expiresAt;
  function closeEditor() { setEditing(false); setDismissedEditRequest(editRequest); }
  function save() { const failure = onEdit({ amount: edited.amount.trim(), recipient: edited.recipient.trim() }); setError(failure ?? ''); if (!failure) closeEditor(); }
  if (quote) return <View style={{ gap: 12 }}>{expired && <ToolStateCard kind="expired" />}
    <Card style={{ gap: 6, borderRadius: 28, paddingVertical: 16 }}><Label size={11} color={c.muted} weight="semibold">YOU SEND</Label><Label size={28} weight="semibold" style={{ lineHeight: 36 }}>{money(units(draft.amount) ?? 0)} USDt</Label><Divider /><Field label="FROM" value="Personal wallet" /><Label size={11} color={c.muted} weight="semibold">TO {recipient?.name.toUpperCase() ?? 'RECIPIENT'} · FULL ADDRESS</Label><Address value={draft.recipient} /><Divider /><Field label="NETWORK" value="Arbitrum · Demo" /><Divider /><Field label="ESTIMATED FEE" value={expired ? 'No longer valid' : '0.02 USDt'} /><Divider /><Field label="TOTAL DEBIT" value={expired ? 'Refresh needed' : `${money((units(draft.amount) ?? 0) + FEE)} USDt`} /><Divider /><Note>{expired ? 'Nothing has been sent.' : `Quote valid for ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))} seconds · Nothing sent yet.`}</Note></Card>
    <Button label={expired ? 'Refresh quote' : `Confirm & send ${money(units(draft.amount) ?? 0)} USDt`} disabled={state.offline} onPress={expired ? onReview : onConfirm} /><Button secondary label="Back to draft" onPress={onCancelReview} />
  </View>;
  return <View style={{ gap: 8 }}><Label size={12} weight="medium" color={c.muted}>{status === 'active' ? 'Current draft' : status === 'superseded' ? 'Replaced by your updated draft' : status === 'cancelled' ? 'Draft cancelled' : 'Transfer submitted · Receipt below'}</Label><Card style={{ gap: 12, opacity: status === 'active' ? 1 : .6 }}><View style={[shared.row, { alignItems: 'flex-start' }]}><WallyAsset name="690ea.svg" /><Label weight="semibold" style={{ flex: 1, lineHeight: 20 }}>Transfer draft</Label></View><Label size={28} weight="semibold" style={{ lineHeight: 39 }}>{money(units(draft.amount) ?? 0)} USDt</Label><Field label="From" value="Personal wallet" /><Field label="To" value={`${recipient ? recipient.name + ' · ' : ''}${draft.recipient.slice(0, 6)}…${draft.recipient.slice(-4)}`} /><Field label="Network" value="Arbitrum · Demo" /><Field label="Network fee" value="Estimated at review" /></Card>
    {status === 'active' && (isEditing ? <Card><Label weight="semibold">Edit this draft</Label><Label size={12} color={c.muted}>AMOUNT · USDt</Label><TextInput accessibilityLabel="Edit draft amount" keyboardType="decimal-pad" value={edited.amount} onChangeText={amount => setEdited({ ...edited, amount })} style={shared.input} /><Label size={12} color={c.muted}>FULL RECIPIENT ADDRESS</Label><TextInput accessibilityLabel="Edit draft recipient" autoCapitalize="none" value={edited.recipient} onChangeText={address => setEdited({ ...edited, recipient: address })} multiline style={shared.input} />{!!error && <Note error>{error}</Note>}<Button label="Save updated draft" onPress={save} /><Button secondary label="Keep current draft" onPress={closeEditor} /></Card> : <><Button label={state.offline ? 'Edit saved draft' : 'Review current draft'} onPress={state.offline ? () => setEditing(true) : onReview} /><Pressable accessibilityRole="button" accessibilityLabel="Edit current draft" onPress={() => setEditing(true)} style={{ padding: 8 }}><Label color={c.muted} style={shared.center}>Edit draft</Label></Pressable></>)}
    {status === 'cancelled' && <Note>Nothing was sent.</Note>}{transaction && <TransactionChatCard transaction={transaction} />}
  </View>;
}
const supply = (value: number | null, symbol: string, missing: string) => value === null ? missing : `${value.toLocaleString('en-US', { notation: 'compact' })} ${symbol}`;
/** One asset's price and facts, answering "Explain Bitcoin" inside the chat. */
export function AssetChatCard({ symbol }: { symbol: string }) {
  const { data, currency, loading } = useMarket();
  const coin = COINS.find(item => item.symbol === symbol);
  const asset = data?.assets.find(item => item.symbol === symbol);
  if (!coin) return <Card><Label weight="semibold">Asset not tracked</Label><Note>Wally follows Bitcoin, Ethereum, Solana and Tether.</Note></Card>;
  return <Card style={{ gap: 12 }}>
    <View style={shared.row}><AssetLogo symbol={coin.symbol} /><View style={shared.flex}><Label size={18} weight="bold">{coin.name}</Label><Label size={12} color={c.muted}>{coin.symbol} · 24h</Label></View><View style={{ alignItems: 'flex-end', flexShrink: 1 }}><Label size={16} weight="semibold">{asset ? formatPrice(asset.price, currency) : loading ? 'Loading…' : 'Unavailable'}</Label><Label size={12} color={!asset || asset.change === null ? c.muted : asset.change < 0 ? c.error : c.success}>{formatChange(asset?.change ?? null)}</Label></View></View>
    <Divider /><Detail label="Market cap" value={formatPrice(asset?.cap ?? null, currency, true)} /><Detail label="Circulating supply" value={supply(asset?.supply ?? null, coin.symbol, 'Unavailable')} /><Detail label="Maximum supply" value={supply(asset?.maximum ?? null, coin.symbol, 'Not reported')} />
    <MarketStatus />
  </Card>;
}
/** Tracked assets ranked by the size of their 24h move; stablecoins are left out. */
export function MoversChatCard({ onAsk }: { onAsk: (text: string) => void }) {
  const { data, loading } = useMarket();
  const movers = (data?.assets ?? []).filter(asset => asset.symbol !== 'USDT' && asset.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  return <Card><Label size={18} weight="bold">Top movers · 24h</Label>{movers.map(asset => <AssetRow key={asset.symbol} asset={asset} onPress={() => onAsk(`Explain ${asset.name}`)} />)}{!movers.length && <Note>{loading ? 'Loading price changes…' : 'No 24h price changes are available right now.'}</Note>}<MarketStatus refresh /></Card>;
}
const CURRENCIES = [['USD', 'US dollar'], ['NGN', 'Nigerian naira'], ['EUR', 'Euro']] as const;
export function CurrencyChatCard() {
  const { preferences, updatePreferences } = usePreferences();
  return <Card style={{ gap: 0 }}><Label size={18} weight="bold" style={{ marginBottom: 4 }}>Display currency</Label>{CURRENCIES.map(([code, name]) => { const selected = preferences.currency === code; return <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${name}, ${code}`} onPress={() => updatePreferences({ currency: code })} style={[shared.between, { minHeight: 60, borderBottomWidth: 1, borderColor: c.line }]}><View><Label size={16} weight="medium">{code}</Label><Label size={12} color={c.muted}>{name}</Label></View><View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? c.orange : c.line, alignItems: 'center', justifyContent: 'center' }}>{selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.orange }} />}</View></Pressable>; })}<View style={{ height: 12 }} /><Note>Market prices and charts refresh in the selected currency. Wallet token quantities do not change.</Note></Card>;
}
export function InlineChatTool({ tool, onRetry, onManual, onAsk }: { tool: ChatTool; onRetry: () => void; onManual: (recipient?: string, amount?: string) => void; onAsk: (text: string) => void }) {
  const { state } = useDemo();
  const { data: market } = useMarket();
  const { preferences } = usePreferences();
  if (tool.kind === 'live-balances') return <LiveWalletOverview onActivity={() => onAsk('Show my transaction history')} />;
  if (tool.kind === 'live-receive') return <LiveReceiveCard />;
  if (tool.kind === 'live-activity') return <LiveActivityCard compact />;
  if (tool.kind === 'live-send') return <Card><Label size={18} weight="semibold">Send testnet ETH</Label><Note>Choose the network, amount and recipient in Send. You approve the exact fee review before anything is broadcast.</Note><Button label="Open Send" onPress={() => router.push('/send')} /></Card>;
  if (tool.kind === 'balances') return <View style={{ gap: 12 }}><WalletOverview balance={tool.balance} snapshot transactionId={tool.transactionId} /><Note>{tool.offline ? 'Cached' : 'Sample'} balances when requested · Fictional funds</Note></View>;
  if (tool.kind === 'receive') return <ReceiveChatCard />;
  if (tool.kind === 'market') return <Card><Label size={18} weight="bold">Today’s market</Label>{market?.assets.map(asset => <AssetRow key={asset.symbol} asset={asset} onPress={() => onAsk(`Explain ${asset.name}`)} />)}<MarketStatus refresh /></Card>;
  if (tool.kind === 'asset') return <AssetChatCard symbol={tool.symbol} />;
  if (tool.kind === 'movers') return <MoversChatCard onAsk={onAsk} />;
  if (tool.kind === 'currency') return <CurrencyChatCard />;
  if (tool.kind === 'activity') { const transactions = state.transactions.filter(tx => tool.transactionIds.includes(tx.id)); return <Card><Label size={12} color={c.muted}>RECENT TRANSACTIONS</Label>{transactions.slice(0, 5).map(tx => <Pressable key={tx.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} style={[shared.row, { minHeight: 76, borderBottomWidth: 1, borderColor: c.line }]}><WallyAsset name="690ea.svg" /><View style={shared.flex}><Label size={16} weight="semibold">Sent to {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label><Label size={13} color={c.muted}>{money(units(tx.amount) ?? 0)} USDt · {tx.status}</Label></View></Pressable>)}{!transactions.length && <Note>No approved demo transfers yet.</Note>}<Button secondary label="View activity" onPress={() => router.push('/history')} /></Card>; }
  if (tool.kind === 'clarify') return <Card><Label size={18} weight="bold" style={{ lineHeight: 22 }}>{tool.field === 'recipient' ? 'Which recipient do you mean?' : tool.field === 'amount' ? 'How much would you like to send?' : 'Choose a supported network'}</Label>{tool.field === 'recipient' ? preferences.recipients.filter(item => item.network === 'Arbitrum').map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => onManual(item.address)} style={{ paddingVertical: 12, gap: 4, borderBottomWidth: 1, borderColor: c.line }}><Label size={16} weight="medium">{item.name} · Arbitrum</Label><Note>{item.address.slice(0, 6)}…{item.address.slice(-4)} · Saved on this device</Note></Pressable>) : tool.field === 'amount' ? <View style={shared.row}>{['25', '50'].map(amount => <Button key={amount} secondary label={`${amount} USDt`} onPress={() => onManual(undefined, amount)} style={shared.flex} />)}</View> : <Note>Arbitrum USDt is the only simulated send asset. Choose the recipient and amount in manual send.</Note>}<Button secondary label="Open manual send" onPress={() => onManual()} /><Note>Nothing is sent while you choose.</Note></Card>;
  return <ToolStateCard kind={tool.kind} onAction={tool.kind === 'timeout' ? onRetry : tool.kind === 'insufficient' || tool.kind === 'blocked' ? () => onManual() : () => router.push('/wallet')} />;
}

/** Wallet tools behind the composer's + button. */
export function WalletToolsModal({ visible, onClose, onManual }: { visible: boolean; onClose: () => void; onManual: () => void }) {
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: '#0000003D', justifyContent: 'center', alignItems: 'center', padding: 24 }}><Pressable accessibilityRole="button" accessibilityLabel="Dismiss wallet tools" onPress={onClose} style={StyleSheet.absoluteFill} /><Card style={{ width: '100%', maxWidth: 384 }}><Label size={18} weight="bold">Wallet tools</Label><Button secondary label="Manual send" onPress={() => { onClose(); onManual(); }} /><Button secondary label="Receive address" onPress={() => { onClose(); router.push('/receive'); }} /><Button secondary label="Close tools" onPress={onClose} /></Card></View></Modal>;
}
