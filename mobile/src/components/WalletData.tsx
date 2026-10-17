import React, { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Pressable, Share, View } from 'react-native';
import { Button, Card, Label, Note, QrTile, ReceiveAddress, shared } from './ui';
import { useWallet } from '../data/wallet';
import { CHAINS, formatEth, type Chain } from '../services/wallet-api';
import { colors as c } from '../theme';

/** Figma network/receive-selector: one pill with the selected network on an amber segment. */
export function NetworkChoice({ value, onChange }: { value: Chain; onChange: (value: Chain) => void }) {
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 4, borderRadius: 29, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>{(Object.keys(CHAINS) as Chain[]).map(chain => { const selected = value === chain; return <Pressable key={chain} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected }} accessibilityLabel={CHAINS[chain].name} onPress={() => onChange(chain)} style={{ flex: 1, minHeight: 46, paddingHorizontal: 8, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.amber : 'transparent' }}><Label size={15} weight={selected ? 'semibold' : 'medium'} numberOfLines={1}>{CHAINS[chain].name}</Label></Pressable>; })}</View>;
}
export function WalletStatus() {
  const wallet = useWallet();
  return <View style={{ gap: 8 }}><Note>{wallet.loading ? 'Refreshing testnet balances…' : wallet.snapshot ? `${wallet.stale ? 'Saved' : 'Fetched'} balances · ${new Date(wallet.snapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to the local wallet…'}</Note>{!!wallet.error && <Note error>{wallet.error}</Note>}<Note>WDK wallet on your computer · Testnet ETH has no monetary value.</Note><Button secondary label="Refresh wallet" disabled={wallet.loading || wallet.offline} onPress={() => { void wallet.refresh(); }} /></View>;
}
/** Figma network/icon-fallback: a tinted letter mark per network. */
function NetworkMark({ chain }: { chain: Chain }) {
  return <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: chain === 'arbitrum' ? c.amber : c.tint }}><Label size={17} weight="semibold">{chain === 'arbitrum' ? 'A' : 'E'}</Label></View>;
}
/** Figma home/wallet-overview + wallet/network-balances: one total, then each network's balance. */
export function LiveWalletOverview({ onActivity = () => router.push('/history') }: { onActivity?: () => void } = {}) {
  const wallet = useWallet();
  const balances = wallet.snapshot?.balances ?? [];
  const known = balances.filter(item => item.balanceWei !== null);
  const total = known.length ? formatEth(known.reduce((sum, item) => sum + BigInt(item.balanceWei!), 0n)) : null;
  const synced = wallet.snapshot ? `${wallet.stale ? 'Saved' : 'Updated'} ${new Date(wallet.snapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to the local wallet…';
  return <View style={{ gap: 12 }}>
    <Card style={{ backgroundColor: c.tint, borderColor: c.tint, alignItems: 'center', gap: 4, paddingVertical: 24 }}>
      <Label size={16} weight="medium">Personal wallet</Label>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}><Label size={40} weight="semibold" style={{ lineHeight: 48 }}>{total ?? '—'}</Label><Label size={16} weight="semibold">ETH</Label></View>
      <Label size={13} color={c.muted}>{wallet.loading ? 'Refreshing balances…' : `${balances.length || Object.keys(CHAINS).length} test networks · ${synced}`}</Label>
      {known.length < balances.length && <Label size={12} color={c.error}>Total excludes a network that could not refresh</Label>}
    </Card>
    <Card style={{ gap: 0, paddingVertical: 12 }}>
      <Label size={16} weight="bold" style={{ paddingBottom: 4 }}>By network</Label>
      {balances.map(item => <View key={item.chain} style={{ paddingVertical: 12, gap: 6, borderTopWidth: 1, borderColor: c.line }}>
        <View style={shared.row}><NetworkMark chain={item.chain} /><View style={shared.flex}><Label size={16} weight="medium">{item.chain === 'arbitrum' ? 'Arbitrum' : 'Ethereum'}</Label><Label size={12} color={c.muted}>Sepolia · Testnet</Label></View><View style={{ alignItems: 'flex-end', flexShrink: 1 }}><Label size={16} weight="semibold">{item.balance === null ? 'Unavailable' : `${item.balance} ETH`}</Label><Label size={12} color={item.error ? c.error : c.muted}>{item.error ? 'Could not refresh' : 'Available balance'}</Label></View></View>
        {!!item.error && <Note error>{item.error}</Note>}
      </View>)}
      {!wallet.snapshot && <Note>Balances appear after the wallet API responds.</Note>}
    </Card>
    {!!wallet.error && <Note error>{wallet.error}</Note>}
    <Note>Testnet ETH only, held by the WDK wallet on your computer. It has no monetary value; USDt isn’t connected.</Note>
    <View style={shared.row}><Button secondary label="Refresh" disabled={wallet.loading || wallet.offline} style={shared.flex} onPress={() => { void wallet.refresh(); }} /><Button secondary label="Activity" style={shared.flex} onPress={onActivity} /></View>
  </View>;
}
export function LiveReceiveCard() {
  const wallet = useWallet();
  const [chain, setChain] = useState<Chain>('arbitrum'), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  const balance = wallet.snapshot?.balances.find(item => item.chain === chain);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  async function copy() { if (!balance) return; try { const ok = await Clipboard.setStringAsync(balance.address); setCopied(ok); setNotice(ok ? '' : 'Copy is unavailable on this device. Share the address instead.'); } catch { setNotice('Copy is unavailable on this device. Share the address instead.'); } }
  return <Card style={{ gap: 16 }}>
    <View style={{ gap: 4 }}><Label size={18} weight="bold" style={{ lineHeight: 22 }}>Receive testnet ETH</Label><Note>{CHAINS[chain].name} · Testnet</Note></View>
    <NetworkChoice value={chain} onChange={next => { setChain(next); setNotice(''); setCopied(false); }} />
    {balance ? <><QrTile><Image source={{ uri: balance.qr }} contentFit="contain" accessibilityLabel={`QR code for ${balance.address}`} style={{ width: 168, height: 168 }} /></QrTile><ReceiveAddress value={balance.address} onCopy={() => { void copy(); }} /><View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} style={shared.flex} onPress={() => { void copy(); }} /><Button accent label="Share" style={shared.flex} onPress={() => { void Share.share({ message: `Wally ${CHAINS[chain].name} testnet ETH address: ${balance.address}. Testnet only.` }).catch(() => setNotice('Sharing is unavailable. You can copy the address.')); }} /></View></> : <WalletStatus />}
    <Note>Send only testnet ETH on {CHAINS[chain].name}. The same address works on both test networks.</Note>{!!notice && <Note error>{notice}</Note>}
  </Card>;
}
export function LiveActivityCard({ compact = false, search = '', filter = 'All' }: { compact?: boolean; search?: string; filter?: string }) {
  const wallet = useWallet();
  const { refreshHistory } = wallet;
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  const addresses = wallet.snapshot?.balances.map(item => item.address.toLowerCase()) ?? [];
  const matches = wallet.history?.items.filter(item => {
    const sent = !!item.from && addresses.includes(item.from.toLowerCase());
    const received = !!item.recipient && addresses.includes(item.recipient.toLowerCase());
    return (filter === 'All' || filter === 'Sent' && sent || filter === 'Received' && received) && `${item.hash} ${item.recipient} ${item.from} ${item.amount} ${item.status} ${CHAINS[item.chain].name}`.toLowerCase().includes(search.toLowerCase());
  }) ?? [];
  return <Card><Label size={18} weight="semibold">On-chain activity</Label>{wallet.historyLoading && <Note>Checking the explorers and network receipts…</Note>}{!!wallet.historyError && <Note error>{wallet.historyError}</Note>}{wallet.history?.errors.map(error => <Note key={error} error>{error}</Note>)}{matches.slice(0, compact ? 3 : 50).map(item => { const sent = !!item.from && addresses.includes(item.from.toLowerCase()); const address = sent ? item.recipient : item.from; return <Pressable key={`${item.chain}:${item.hash}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/transaction', params: { chain: item.chain, hash: item.hash } })} style={{ gap: 4, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line }}><View style={shared.between}><Label>{sent ? 'Sent' : 'Received'} {item.amount ?? '—'} ETH</Label><Label size={12} color={item.status === 'failed' ? c.error : c.muted}>{item.status}</Label></View><Note>{CHAINS[item.chain].name} · {address ? `${address.slice(0, 8)}…${address.slice(-6)}` : item.hash.slice(0, 12)}</Note></Pressable>; })}{!matches.length && !wallet.historyLoading && <Note>{wallet.history ? 'No matching transactions were returned. Explorer errors above mean history may be incomplete.' : 'Activity has not been fetched yet.'}</Note>}{wallet.history && <Note>{wallet.offline || wallet.historyError ? 'Saved' : 'Fetched'} activity · {new Date(wallet.history.fetchedAt).toLocaleTimeString()} · Blockscout and local receipts. Token transfers and internal contract activity are not included.</Note>}<Button secondary label="Refresh activity" disabled={wallet.historyLoading || wallet.offline} onPress={() => { void wallet.refreshHistory(); }} />{compact && <Button secondary label="View all activity" onPress={() => router.push('/history')} />}</Card>;
}
