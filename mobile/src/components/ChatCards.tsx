import React, { useState } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Modal, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { Address, Button, Card, Detail, Divider, Group, Label, Note, Pill, QrTile, ReceiveAddress, Row, useShared } from './ui';
import { CURRENCIES } from '../services/preferences-store';
import { WallyAsset } from './WallyAsset';
import { WalletOverview } from './WalletOverview';
import { AssetLogo, AssetRow } from './MarketRows';
import { Sparkline } from './Sparkline';
import { useMarket } from '../data/market';
import { MarketStatus } from './MarketData';
import { COINS, formatChange, formatPrice } from '../services/market-api';
import { DEMO_ADDRESS, FEE, draftStatus, money, units, type ChatContext, type ChatTool, type Draft, type Message, type Quote, type Transaction } from '../demo/model';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { useColors } from '../theme';
import { LiveActivityList, LiveReceiveCard, LiveWalletOverview } from './WalletData';

function Field({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><Label size={12} color={c.muted} style={{ width: '31%', lineHeight: 17 }}>{label}</Label><Label size={12} weight="medium" style={{ flex: 1, textAlign: 'right', lineHeight: 17 }}>{value}</Label></View>;
}
export function ToolStateCard({ kind, detail, onAction }: { kind: 'unavailable' | 'timeout' | 'stopped' | 'expired' | 'insufficient' | 'blocked'; detail?: string; onAction?: () => void }) {
  const c = useColors();
  const shared = useShared();
  const copy = {
    unavailable: ['Wally is unavailable', 'Use the wallet tools while the assistant is unavailable.', 'Open wallet'],
    timeout: ['That took too long', 'The request timed out. Your wallet is still available.', 'Try again'],
    stopped: ['Request stopped', 'Nothing was submitted. Your wallet is still available.', 'Continue'],
    expired: ['This quote has expired', 'Refresh the fee before reviewing again. Nothing was sent.', 'Refresh quote'],
    insufficient: ['Not enough USDt', 'Choose a smaller amount or receive USDt into this wallet.', 'Edit amount'],
    blocked: ['This action needs your review', 'Use the wallet controls to check the details. Nothing was sent.', 'Open manual send'],
  }[kind];
  // A plain card in the chat's own type: the icon says which kind, the title says what, and the
  // body says what is still available. No amber wash: a stopped request is not an alarm.
  return <Card style={{ gap: 12 }}><View style={[shared.row, { alignItems: 'flex-start' }]}><View style={{ width: 24, alignItems: 'center' }}><WallyAsset name={kind === 'unavailable' ? '4ee0b.svg' : ['expired', 'insufficient', 'blocked'].includes(kind) ? '91154.svg' : '8dca8.svg'} /></View><Label size={16} weight="semibold" style={{ flex: 1, lineHeight: 22 }}>{copy[0]}</Label></View><Label size={14} color={c.muted} style={{ lineHeight: 21 }}>{detail || copy[1]}</Label>{onAction && <Button secondary label={copy[2]} onPress={onAction} />}</Card>;
}
export function ReceiveChatCard() {
  const c = useColors();
  const shared = useShared();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  async function copy() { try { const ok = await Clipboard.setStringAsync(DEMO_ADDRESS); setCopied(ok); setError(ok ? '' : 'Copy is unavailable on this device. Share the address instead.'); } catch { setError('Copy is unavailable on this device. Share the address instead.'); } }
  async function share() { try { await Share.share({ message: `Wally preview address (fictional; do not fund): ${DEMO_ADDRESS}` }); setError(''); } catch { setError('Sharing is unavailable. You can still copy the address.'); } }
  return <Card style={{ gap: 12 }}><View style={shared.between}><Label size={16} weight="semibold" style={{ lineHeight: 22 }}>Receive USDt · Arbitrum</Label><Pill tone="warning">Demo · do not fund</Pill></View><QrTile><WallyAsset name="eab8b.svg" tint={false} /></QrTile><ReceiveAddress value={DEMO_ADDRESS} onCopy={() => { void copy(); }} /><View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} onPress={() => { void copy(); }} style={[shared.flex, { paddingHorizontal: 12 }]} /><Button accent label="Share" onPress={() => { void share(); }} style={shared.flex} /></View>{copied && <Label size={12} color={c.success} accessibilityLiveRegion="polite">Address copied</Label>}{!!error && <Note error>{error}</Note>}</Card>;
}
export function TransactionChatCard({ transaction: tx }: { transaction: Transaction }) {
  const c = useColors();
  const shared = useShared();
  const pending = tx.status === 'pending', failed = tx.status === 'failed';
  const badge = pending ? 'a6471.svg' : failed ? '68d0f.svg' : 'd5ad6.svg';
  const icon = pending ? 'bfc84.svg' : failed ? '98a2e.svg' : '0c821.svg';
  const line = c.line;
  return <Card style={{ backgroundColor: pending ? c.amber : failed ? c.errorTint : c.successTint, borderColor: line, borderRadius: 28, gap: 16 }}>
    <View style={shared.row}><View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><WallyAsset name={badge} style={{ position: 'absolute' }} /><WallyAsset name={icon} /></View><Label size={16} weight="semibold" style={{ flex: 1, lineHeight: 22 }}>{pending ? 'Pending confirmation' : failed ? 'Transfer failed' : 'Transfer confirmed'}</Label></View>
    <View style={{ height: 1, backgroundColor: line }} />
    {(['Approved by you', 'Submitted to demo simulation', pending ? 'Waiting for confirmation' : failed ? 'Demo transfer rejected' : 'Confirmed by simulation'] as const).map((label, index) => <View key={label} style={[shared.row, { minHeight: 28 }]}><WallyAsset name={index < 2 ? '70fe0.svg' : pending ? '3fc33.svg' : failed ? '5cfbe.svg' : 'de3bd.svg'} /><Label size={16} weight={index < 2 ? 'semibold' : 'regular'} color={index < 2 ? c.ink : c.muted} style={{ flex: 1, lineHeight: 21 }}>{label}</Label></View>)}
    <View style={{ height: 1, backgroundColor: line }} /><View style={shared.between}><Label size={18} weight="semibold">{money(units(tx.amount) ?? 0)} USDt</Label><Label size={13} color={c.muted} style={{ flexShrink: 1, textAlign: 'right' }}>To {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label></View>
    {!pending && <><View style={{ height: 1, backgroundColor: line }} /><Field label={failed ? 'Refunded' : 'Network fee'} value={`${money(failed ? (units(tx.amount) ?? 0) + FEE : FEE)} USDt`} /><Field label="Time" value={new Date(tx.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} /></>}
    <Button secondary label="Open receipt" onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} />
  </Card>;
}
export function DraftChatCard({ message, quote, now, editRequest = 0, onReview, onCancelReview, onConfirm, onEdit }: { message: Message; quote: Quote | null; now: number; editRequest?: number; onReview: () => void; onCancelReview: () => void; onConfirm: () => void; onEdit: (draft: Draft) => string | null }) {
  const c = useColors();
  const shared = useShared();
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
    <Card style={{ gap: 6, borderRadius: 28, paddingVertical: 16 }}><Label size={28} weight="semibold" style={{ lineHeight: 36 }}>{money(units(draft.amount) ?? 0)} USDt</Label><Divider /><Field label="From" value="Personal wallet" /><Label size={12} color={c.muted}>To{recipient ? ` ${recipient.name}` : ''}</Label><Address value={draft.recipient} /><Divider /><Field label="Network" value="Arbitrum · Demo" /><Divider /><Field label="Fee" value={expired ? 'No longer valid' : '0.02 USDt'} /><Divider /><Field label="Total" value={expired ? 'Refresh needed' : `${money((units(draft.amount) ?? 0) + FEE)} USDt`} /><Divider /><Note>{expired ? 'Nothing has been sent.' : `Expires in ${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))} s`}</Note></Card>
    <Button label={expired ? 'Refresh quote' : `Send ${money(units(draft.amount) ?? 0)} USDt`} disabled={state.offline} onPress={expired ? onReview : onConfirm} /><Button secondary label="Back to draft" onPress={onCancelReview} />
  </View>;
  // The current draft needs no caption, it is the card; only a draft that is no longer current says why.
  return <View style={{ gap: 8 }}>{status !== 'active' && <Label size={12} weight="medium" color={c.muted}>{status === 'superseded' ? 'Replaced by your updated draft' : status === 'cancelled' ? 'Draft cancelled' : 'Transfer submitted · Receipt below'}</Label>}<Card style={{ gap: 12, opacity: status === 'active' ? 1 : .6 }}><View style={[shared.row, { alignItems: 'flex-start' }]}><WallyAsset name="690ea.svg" /><Label weight="semibold" style={{ flex: 1, lineHeight: 20 }}>Transfer draft</Label></View><Label size={28} weight="semibold" style={{ lineHeight: 39 }}>{money(units(draft.amount) ?? 0)} USDt</Label><Field label="From" value="Personal wallet" /><Field label="To" value={`${recipient ? recipient.name + ' · ' : ''}${draft.recipient.slice(0, 6)}…${draft.recipient.slice(-4)}`} /><Field label="Network" value="Arbitrum · Demo" /><Field label="Network fee" value="Estimated at review" /></Card>
    {status === 'active' && (isEditing ? <Card><Label size={12} color={c.muted}>Amount (USDt)</Label><TextInput accessibilityLabel="Edit draft amount" keyboardType="decimal-pad" value={edited.amount} onChangeText={amount => setEdited({ ...edited, amount })} style={shared.input} /><Label size={12} color={c.muted}>Recipient address</Label><TextInput accessibilityLabel="Edit draft recipient" autoCapitalize="none" value={edited.recipient} onChangeText={address => setEdited({ ...edited, recipient: address })} multiline style={shared.input} />{!!error && <Note error>{error}</Note>}<Button label="Save" onPress={save} /><Button secondary label="Cancel" onPress={closeEditor} /></Card> : <><Button label={state.offline ? 'Edit saved draft' : 'Review current draft'} onPress={state.offline ? () => setEditing(true) : onReview} /><Pressable accessibilityRole="button" accessibilityLabel="Edit current draft" onPress={() => setEditing(true)} style={{ padding: 8 }}><Label color={c.muted} style={shared.center}>Edit draft</Label></Pressable></>)}
    {status === 'cancelled' && <Note>Nothing was sent.</Note>}{transaction && <TransactionChatCard transaction={transaction} />}
  </View>;
}
const supply = (value: number | null, symbol: string, missing: string) => value === null ? missing : `${value.toLocaleString('en-US', { notation: 'compact' })} ${symbol}`;
/** One asset's price and facts, answering "Explain Bitcoin" inside the chat. */
export function AssetChatCard({ symbol }: { symbol: string }) {
  const c = useColors();
  const shared = useShared();
  const { data, currency, loading } = useMarket();
  const coin = COINS.find(item => item.symbol === symbol);
  const asset = data?.assets.find(item => item.symbol === symbol);
  if (!coin) return <Card><Label weight="semibold">Asset not tracked</Label><Note>Wally follows Bitcoin, Ethereum, Solana and Tether.</Note></Card>;
  return <Card style={{ gap: 12 }}>
    <View style={shared.row}><AssetLogo symbol={coin.symbol} /><View style={shared.flex}><Label size={16} weight="semibold">{coin.name}</Label><Label size={12} color={c.muted}>{coin.symbol} · 24h</Label></View><View style={{ alignItems: 'flex-end', flexShrink: 1 }}><Label size={16} weight="semibold">{asset ? formatPrice(asset.price, currency) : loading ? 'Loading…' : 'Unavailable'}</Label><Label size={12} color={!asset || asset.change === null ? c.muted : asset.change < 0 ? c.error : c.success}>{formatChange(asset?.change ?? null)}</Label></View></View>
    <Divider /><Detail label="Market cap" value={formatPrice(asset?.cap ?? null, currency, true)} /><Detail label="Circulating supply" value={supply(asset?.supply ?? null, coin.symbol, 'Unavailable')} /><Detail label="Maximum supply" value={supply(asset?.maximum ?? null, coin.symbol, 'Not reported')} />
    <MarketStatus />
  </Card>;
}
/** Tracked assets ranked by the size of their 24h move; stablecoins are left out. */
export function MoversChatCard({ onAsk }: { onAsk: (text: string) => void }) {
  const { data, loading } = useMarket();
  const movers = (data?.assets ?? []).filter(asset => asset.symbol !== 'USDT' && asset.change !== null).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  return <View style={{ gap: 8 }}><Group title="Top movers · 24h">{movers.map(asset => <AssetRow key={asset.symbol} asset={asset} onPress={() => onAsk(`Explain ${asset.name}`)} />)}</Group>{!movers.length && <Note>{loading ? 'Loading price changes…' : 'No 24h price changes right now.'}</Note>}<MarketStatus refresh /></View>;
}
const CURRENCY_NAMES: Record<(typeof CURRENCIES)[number], string> = { USD: 'US dollar', NGN: 'Nigerian naira', EUR: 'Euro' };
/** The display currency as a radio list; the same control in Profile and in chat. */
export function CurrencyChoice() {
  const { preferences, updatePreferences } = usePreferences();
  return <Group title="Currency">{CURRENCIES.map(code => <Row key={code} title={CURRENCY_NAMES[code]} value={code} selected={preferences.currency === code} onPress={() => updatePreferences({ currency: code })} />)}</Group>;
}
export function InlineChatTool({ tool, onRetry, onManual, onAsk }: { tool: ChatTool; onRetry: () => void; onManual: (recipient?: string, amount?: string) => void; onAsk: (text: string) => void }) {
  const c = useColors();
  const shared = useShared();
  const { state } = useDemo();
  const { data: market } = useMarket();
  const { preferences } = usePreferences();
  if (tool.kind === 'live-balances') return <LiveWalletOverview inline />;
  if (tool.kind === 'live-receive') return <LiveReceiveCard />;
  if (tool.kind === 'live-activity') return <LiveActivityList compact />;
  if (tool.kind === 'live-send') return <Card><Label size={18} weight="semibold">Send on testnet</Label><Button label="Open Send" onPress={() => router.push('/send')} /></Card>;
  if (tool.kind === 'balances') return <WalletOverview balance={tool.balance} snapshot transactionId={tool.transactionId} />;
  if (tool.kind === 'receive') return <ReceiveChatCard />;
  if (tool.kind === 'market') return <View style={{ gap: 8 }}><Group title="Today’s market">{market?.assets.map(asset => <AssetRow key={asset.symbol} asset={asset} onPress={() => onAsk(`Explain ${asset.name}`)} />)}</Group><MarketStatus refresh /></View>;
  if (tool.kind === 'asset') return <AssetChatCard symbol={tool.symbol} />;
  if (tool.kind === 'movers') return <MoversChatCard onAsk={onAsk} />;
  if (tool.kind === 'currency') return <CurrencyChoice />;
  if (tool.kind === 'activity') { const transactions = state.transactions.filter(tx => tool.transactionIds.includes(tx.id)); return <Card><Label size={16} weight="semibold">Recent transfers</Label>{transactions.slice(0, 5).map(tx => <Pressable key={tx.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/transaction', params: { id: tx.id } })} style={[shared.row, { minHeight: 76, borderBottomWidth: 1, borderColor: c.line }]}><WallyAsset name="690ea.svg" /><View style={shared.flex}><Label size={16} weight="semibold">Sent to {tx.recipient.slice(0, 6)}…{tx.recipient.slice(-4)}</Label><Label size={13} color={c.muted}>{money(units(tx.amount) ?? 0)} USDt · {tx.status}</Label></View></Pressable>)}{!transactions.length && <Note>No approved demo transfers yet.</Note>}<Button secondary label="View activity" onPress={() => router.push('/history')} /></Card>; }
  if (tool.kind === 'clarify') return <Card><Label size={16} weight="semibold" style={{ lineHeight: 22 }}>{tool.field === 'recipient' ? 'Which recipient do you mean?' : tool.field === 'amount' ? 'How much would you like to send?' : 'Choose a supported network'}</Label>{tool.field === 'recipient' ? preferences.recipients.filter(item => item.network === 'Arbitrum').map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => onManual(item.address)} style={{ paddingVertical: 12, gap: 4, borderBottomWidth: 1, borderColor: c.line }}><Label size={16} weight="medium">{item.name}</Label><Note>{item.address.slice(0, 6)}…{item.address.slice(-4)} · Arbitrum</Note></Pressable>) : tool.field === 'amount' ? <View style={shared.row}>{['25', '50'].map(amount => <Button key={amount} secondary label={`${amount} USDt`} onPress={() => onManual(undefined, amount)} style={shared.flex} />)}</View> : <Note>Arbitrum USDt is the only simulated send asset. Choose the recipient and amount in manual send.</Note>}<Button secondary label="Open manual send" onPress={() => onManual()} /><Note>Nothing is sent while you choose.</Note></Card>;
  return <ToolStateCard kind={tool.kind} onAction={tool.kind === 'timeout' ? onRetry : tool.kind === 'insufficient' || tool.kind === 'blocked' ? () => onManual() : () => router.push('/wallet')} />;
}

/**
 * The composer's tools sheet, behind its + button: a list of places, one row each, with no
 * title and no Close row — tapping outside or the system Back dismisses it. In a conversation
 * it also holds the chat's own actions.
 */
export function WalletToolsModal({ visible, onClose, onManual, onNewChat, onHistory }: { visible: boolean; onClose: () => void; onManual: () => void; onNewChat?: () => void; onHistory?: () => void }) {
  const c = useColors();
  const go = (action: () => void) => () => { onClose(); action(); };
  return <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: c.overlay, justifyContent: 'center', alignItems: 'center', padding: 24 }}><Pressable accessibilityRole="button" accessibilityLabel="Dismiss tools" onPress={onClose} style={StyleSheet.absoluteFill} /><View accessibilityViewIsModal style={{ width: '100%', maxWidth: 384 }}><Group>
    {onNewChat && <Row title="New chat" onPress={go(onNewChat)} />}
    {onHistory && <Row title="Chat history" onPress={go(onHistory)} />}
    <Row title="Manual send" onPress={go(onManual)} />
    <Row title="Receive address" onPress={go(() => router.push('/receive'))} />
  </Group></View></View></Modal>;
}

/**
 * What a chat was opened from, above its first turn: the asset screen's asset with its price,
 * change and week, or the market list. One quiet card, no caption; it belongs to the chat, so
 * it stays until another chat is started. Tapping it goes back to that screen.
 */
export function ChatContextCard({ context }: { context: ChatContext }) {
  const c = useColors();
  const shared = useShared();
  const { data, currency, loading } = useMarket();
  if (context.kind === 'market') return <Group>{(data?.assets ?? []).map(asset => <AssetRow key={asset.symbol} asset={asset} spark />)}</Group>;
  const coin = COINS.find(item => item.symbol === context.symbol);
  const asset = data?.assets.find(item => item.symbol === context.symbol);
  if (!coin) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${coin.name}`} onPress={() => router.push({ pathname: '/asset', params: { symbol: coin.symbol } })}>
    <Card style={{ gap: 12 }}>
      <View style={shared.row}><AssetLogo symbol={coin.symbol} /><Label size={16} weight="semibold" style={shared.flex}>{coin.name}</Label><View style={{ alignItems: 'flex-end', flexShrink: 1 }}><Label size={16} weight="semibold">{asset ? formatPrice(asset.price, currency) : loading ? 'Loading…' : 'Unavailable'}</Label><Label size={12} color={!asset || asset.change === null ? c.muted : asset.change < 0 ? c.error : c.success}>{formatChange(asset?.change ?? null)}</Label></View></View>
      <Sparkline id={coin.id} fill height={56} />
    </Card>
  </Pressable>;
}
