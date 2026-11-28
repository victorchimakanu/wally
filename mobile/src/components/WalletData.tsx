import React, { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { createClipboardSafety, copyNotice } from '../services/clipboard-safety.ts';
import { Pressable, Share, View } from 'react-native';
import { Button, Card, Group, Label, LinkButton, Note, Pill, QrTile, ReceiveAddress, Row, useShared } from './ui';
import { WalletCard, type WalletTab } from './WalletCard';
import { TransferRow } from './TransferRow';
import { useWallet } from '../data/wallet';
import { usePreferences } from '../demo/preferences';
import { custodyNotice } from '../services/custody';
import { receiveAdvice } from '../services/receive-advice';
import { historyGap } from '../services/history-source';
import { CHAINS, formatEth, type Chain } from '../services/wallet-api';
import { tokenCaveat, tokensFor } from '../services/tokens.ts';
import { fiatDisplayable, fiatTotal } from '../services/fiat-value';
import { formatPrice } from '../services/market-api';
import { liveTransferSummary } from '../services/transfer-summary';
import { clockLabel, dayGroups, whenLabel } from '../services/when';
import { useMarket } from '../data/market';
import { useColors } from '../theme';

/** Figma network/receive-selector: one pill with the selected network on an amber segment. */
/**
 * Pick the asset to send, when the chain has more than one.
 *
 * Built from the same primitives as `NetworkChoice` and deliberately identical in shape, so
 * the Send screen gains a row rather than a new idea.
 */
export function AssetChoice({ value, options, onChange }: { value: string; options: readonly string[]; onChange: (value: string) => void }) {
  const c = useColors();
  if (options.length < 2) return null;
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 4, borderRadius: 29, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
    {options.map(option => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: value === option }} onPress={() => onChange(option)}
      style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 25, backgroundColor: value === option ? c.amber : 'transparent' }}>
      <Label size={14} weight={value === option ? 'semibold' : 'regular'}>{option}</Label>
    </Pressable>)}
  </View>;
}

export function NetworkChoice({ value, onChange }: { value: Chain; onChange: (value: Chain) => void }) {
  const c = useColors();
  return <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 4, borderRadius: 29, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>{(Object.keys(CHAINS) as Chain[]).map(chain => { const selected = value === chain; return <Pressable key={chain} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected }} accessibilityLabel={CHAINS[chain].name} onPress={() => onChange(chain)} style={{ flex: 1, minHeight: 46, paddingHorizontal: 8, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.amber : 'transparent' }}><Label size={15} weight={selected ? 'semibold' : 'medium'} numberOfLines={1}>{CHAINS[chain].name.replace(/ Sepolia$/, '')}</Label></Pressable>; })}</View>;
}
/**
 * The refusal, and the warning that replaces it when a developer opts in.
 *
 * Rendered by every screen that shows money or an address. Receive matters most: an address on
 * screen is an invitation to send funds to it, and in a split that address belongs to a wallet
 * the user’s recovery phrase cannot recover. Showing nothing is the only honest option.
 *
 * Returns null in the two safe states, so a screen can render it unconditionally.
 */
export function CustodyGuard() {
  const c = useColors();
  const wallet = useWallet();

  if (wallet.blocked) return <Card>
    <Pill tone="warning">Two wallets</Pill>
    <Label size={16} weight="medium">This build can’t open your wallet</Label>
    <Note>{wallet.blocked}</Note>
    <Note>Remove the wallet from this phone in Settings, or unset EXPO_PUBLIC_WALLY_API_URL and rebuild. Funds on both are untouched.</Note>
  </Card>;

  // Not a card: one quiet line in the warning colour under the wallet, so the balance stays
  // the thing you look at and the caveat is still said on every screen that shows money.
  const notice = wallet.custody ? custodyNotice(wallet.custody) : null;
  if (!notice) return null;
  return <Label size={13} color={c.warning} style={{ paddingHorizontal: 4 }}>{notice}</Label>;
}

export function WalletStatus() {
  const shared = useShared();
  const wallet = useWallet();
  return <View style={{ gap: 4 }}><View style={shared.between}><Note>{wallet.loading ? 'Updating balances…' : wallet.snapshot ? `${wallet.stale ? 'Saved' : 'Updated'} ${new Date(wallet.snapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Connecting to the wallet…'}</Note><LinkButton label="Refresh" accessibilityLabel="Refresh balances" disabled={wallet.loading || wallet.offline} onPress={() => { void wallet.refresh(); }} /></View>{!!wallet.error && <Note error>{wallet.error}</Note>}</View>;
}
/** Figma network/icon-fallback: a tinted letter mark per network. */
function NetworkMark({ chain }: { chain: Chain }) {
  const c = useColors();
  return <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: chain === 'arbitrum' ? c.amber : c.tint }}><Label size={17} weight="semibold">{chain === 'arbitrum' ? 'A' : 'E'}</Label></View>;
}
/**
 * The caveat for the token in this row, or null.
 *
 * Looked up by chain and symbol because a balance row carries those and not the Token itself.
 * A symbol nothing pins simply has nothing to say about it, so ETH rows get nothing.
 */
function caveatFor(chain: Chain, symbol: string): string | null {
  const token = tokensFor(chain).find(entry => entry.symbol === symbol);
  return token ? tokenCaveat(token) : null;
}

/**
 * The live wallet on the shared card: the ETH total, what it is worth or how fresh it is, and
 * a tab that says the latest thing worth knowing — the last transfer, or why the total is a
 * dash and how to retry. Behind the title's chevron, each network and token in its own units.
 * `inline` is the chat's answer: the bare card with the balances always shown under it.
 */
export function LiveWalletOverview({ inline = false }: { inline?: boolean } = {}) {
  const shared = useShared();
  const wallet = useWallet();
  const market = useMarket();
  const { preferences } = usePreferences();
  const balances = wallet.snapshot?.balances ?? [];
  // What the balances are worth in the chosen currency. Testnet tokens are worth nothing and
  // the app says so, so until the wallet reports a mainnet the figure says it is priced as if
  // they were mainnet coins, rather than being hidden.
  const fiat = balances.length ? fiatTotal(balances.map(item => ({ amount: item.balance, symbol: item.symbol })), market.data?.assets ?? [], market.currency) : null;
  const priced = fiat?.amount == null ? null : `${formatPrice(fiat.amount, fiat.currency)}${fiatDisplayable({ network: wallet.snapshot?.network }) ? '' : ' at mainnet prices'}`;
  // ETH only, and the filter is the whole point: `balanceWei` holds base units at the asset's
  // own scale, so summing across assets would add 10.5 USDt (10,500,000 base units) into a wei
  // total and then label the result ETH. Apples into oranges, presented as apples.
  const nativeKnown = balances.filter(item => item.symbol === 'ETH' && item.balanceWei !== null);
  const total = nativeKnown.length ? formatEth(nativeKnown.reduce((sum, item) => sum + BigInt(item.balanceWei!), 0n)) : null;
  const time = wallet.snapshot ? new Date(wallet.snapshot.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const networks = new Set(balances.map(item => item.chain)).size;
  // Under the figure: its worth while the wallet is fresh, otherwise how old it is; with no
  // snapshot at all, the one word that explains the dash.
  const line = !wallet.snapshot ? (wallet.loading ? 'Connecting…' : 'Not connected')
    : wallet.stale ? `Saved ${time}` : priced ?? `${networks} network${networks === 1 ? '' : 's'}`;
  const refresh = { label: 'Refresh', onPress: () => { void wallet.refresh(); }, disabled: wallet.loading || wallet.offline };
  const activity = () => router.push('/history');
  const latest = wallet.history?.items[0];
  const summary = latest ? liveTransferSummary(latest, balances.map(item => item.address), preferences.recipients) : null;
  const tab: WalletTab = wallet.error ? { title: wallet.snapshot ? `Saved ${time}` : 'Not connected', meta: wallet.error, action: refresh, alert: true }
    : !wallet.snapshot ? { title: 'Connecting to the wallet…' }
    : summary ? { title: summary.headline, meta: summary.meta, onPress: activity }
    : { title: 'No activity yet', onPress: activity };
  const chainName = (chain: Chain) => chain === 'arbitrum' ? 'Arbitrum' : 'Ethereum';
  // Tokens are listed in their own units, never folded into the ETH total; an error is said
  // once, under the row it belongs to.
  const row = (item: (typeof balances)[number]) => <View key={`${item.chain}:${item.symbol}`} style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 6 }}>
    <View style={shared.row}><NetworkMark chain={item.chain} /><Label size={16} weight="medium" style={shared.flex}>{item.symbol === 'ETH' ? chainName(item.chain) : `${item.symbol} · ${chainName(item.chain)}`}</Label><Label size={16} weight="semibold" style={{ flexShrink: 1, textAlign: 'right' }}>{item.balance === null ? 'Unavailable' : `${item.balance} ${item.symbol}`}</Label></View>
    {!!item.error && <Note error>{item.error}</Note>}
    {!!caveatFor(item.chain, item.symbol) && <Note>{caveatFor(item.chain, item.symbol)}</Note>}
  </View>;
  const details = <Group>{[...balances.filter(item => item.symbol === 'ETH'), ...balances.filter(item => item.symbol !== 'ETH')].map(row)}</Group>;
  if (inline) return <View style={{ gap: 12 }}>
    <WalletCard inline amount={total ?? '—'} unit="ETH" line={line} lineLabel={priced ? `About ${priced}` : undefined} />
    {details}
    {!!wallet.error && <View style={shared.between}><Note error>{wallet.error}</Note><LinkButton label="Refresh" accessibilityLabel="Refresh balances" disabled={refresh.disabled} onPress={refresh.onPress} /></View>}
  </View>;
  return <WalletCard amount={total ?? '—'} unit="ETH" line={line} lineLabel={priced ? `About ${priced}` : undefined} tab={tab}>{details}</WalletCard>;
}
export function LiveReceiveCard() {
  const shared = useShared();
  const wallet = useWallet();
  const [chain, setChain] = useState<Chain>('arbitrum'), [notice, setNotice] = useState(''), [copied, setCopied] = useState(false);
  // `symbol` is named explicitly: a chain now has more than one balance, and finding by chain
  // alone returned whichever the server happened to list first.
  const balance = wallet.snapshot?.balances.find(item => item.chain === chain && item.symbol === 'ETH');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  // An address left in the clipboard is readable by every app on the device for as long as it
  // sits there, and clipboard-swapping malware is ordinary in this space. This clears it after
  // a minute, and only if it is still the address we put there.
  const clipboard = useMemo(() => createClipboardSafety(Clipboard), []);
  useEffect(() => () => clipboard.cancel(), [clipboard]);
  async function copy() {
    if (!balance) return;
    try {
      const result = await clipboard.copy(balance.address);
      setCopied(result.copied);
      setNotice(result.copied ? '' : copyNotice(result));
    } catch { setNotice('Copy is unavailable on this device. Share the address instead.'); }
  }
  const addresses = Object.fromEntries((wallet.snapshot?.balances ?? []).map(item => [item.chain, item.address])) as Partial<Record<Chain, string>>;
  const advice = receiveAdvice(chain, CHAINS[chain].name, addresses, key => CHAINS[key].name);
  return <Card style={{ gap: 16 }}>
    <NetworkChoice value={chain} onChange={next => { setChain(next); setNotice(''); setCopied(false); }} />
    {balance ? <><QrTile><Image source={{ uri: balance.qr }} contentFit="contain" accessibilityLabel={`QR code for ${balance.address}`} style={{ width: 168, height: 168 }} /></QrTile><ReceiveAddress value={balance.address} onCopy={() => { void copy(); }} /><View style={shared.row}><Button label={copied ? 'Copied' : 'Copy address'} style={shared.flex} onPress={() => { void copy(); }} /><Button accent label="Share" style={shared.flex} onPress={() => { void Share.share({ message: `Wally ${CHAINS[chain].name} testnet ETH address: ${balance.address}. Testnet only.` }).catch(() => setNotice('Sharing is unavailable. You can copy the address.')); }} /></View></> : <WalletStatus />}
    {/* Derived from the addresses, never asserted. The fixed version of this line claimed the
        same address works on both networks, which held only while the dev server derived one
        EOA for both. Arbitrum's real account is a Safe addressed by the account factory. */}
    <Note error={advice.chainSpecific}>{advice.text}</Note>{!!notice && <Note error>{notice}</Note>}
  </Card>;
}
/**
 * The live wallet's transfers as transfer rows, grouped under Today, Yesterday and Earlier.
 * `compact` is the three latest in one group with a View all row, for the Wallet and for a
 * chat answer; the Activity screen passes its search and filter and gets the whole list with
 * Load older. States with no rows are one plain row; errors are said once, under the list.
 */
export function LiveActivityList({ compact = false, search = '', filter = 'All' }: { compact?: boolean; search?: string; filter?: string }) {
  const shared = useShared();
  const wallet = useWallet();
  const { preferences } = usePreferences();
  const { refreshHistory } = wallet;
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  const owned = wallet.snapshot?.balances.map(item => item.address) ?? [];
  const entries = (wallet.history?.items ?? []).map(item => ({ item, summary: liveTransferSummary(item, owned, preferences.recipients) }));
  const term = search.toLowerCase();
  const matches = entries.filter(({ item, summary }) => (filter === 'All' || (filter === 'Sent') === summary.sent)
    && `${item.hash} ${item.recipient ?? ''} ${item.from ?? ''} ${summary.title} ${item.amount ?? ''} ${item.symbol ?? 'ETH'} ${summary.meta}`.toLowerCase().includes(term));
  const shown = compact ? matches.slice(0, 3) : matches;
  const row = ({ item, summary }: (typeof entries)[number], when?: string) => <TransferRow key={`${item.chain}:${item.hash}`} title={summary.title} meta={summary.meta} amount={summary.amount} when={when} failed={summary.failed} onPress={() => router.push({ pathname: '/transaction', params: { chain: item.chain, hash: item.hash } })} />;
  const status = !wallet.history ? (wallet.historyLoading ? 'Loading…' : wallet.error || wallet.historyError ? 'Not connected' : 'Not loaded yet')
    : matches.length ? null : search || filter !== 'All' ? 'No matches' : 'No transfers yet';
  const time = wallet.history ? new Date(wallet.history.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const stamp = [wallet.history && `${wallet.offline || wallet.historyError ? 'Saved' : 'Updated'} ${time}`, wallet.history && historyGap(wallet.history.source)].filter(Boolean).join(' · ');
  const refresh = <LinkButton label="Refresh" accessibilityLabel="Refresh activity" disabled={wallet.historyLoading || wallet.offline} onPress={() => { void wallet.refreshHistory(); }} />;
  if (compact) return <Group title="Recent activity">
    {shown.map(entry => row(entry, entry.item.submittedAt ? whenLabel(entry.item.submittedAt) : undefined))}
    {!!status && <Row title={status} />}
    <Row title="View all" onPress={() => router.push('/history')} />
  </Group>;
  return <>
    {dayGroups(shown, entry => entry.item.submittedAt).map(group => <Group key={group.title} title={group.title}>
      {group.items.map(entry => row(entry, entry.item.submittedAt === undefined ? undefined : group.title === 'Earlier' ? whenLabel(entry.item.submittedAt) : clockLabel(entry.item.submittedAt)))}
    </Group>)}
    {!!status && <Group><Row title={status} /></Group>}
    {!!wallet.historyError && <Note error>{wallet.historyError}</Note>}
    {wallet.history?.errors.map(error => <Note key={error} error>{error}</Note>)}
    <View style={shared.between}><Note>{stamp}</Note>{refresh}</View>
    {wallet.historyHasMore && <>
      {(!!search || filter !== 'All') && <Note>Search and filters cover the {wallet.history?.items.length ?? 0} transactions loaded so far, not your whole history.</Note>}
      <LinkButton label={wallet.historyLoadingMore ? 'Loading…' : 'Load older'} accessibilityLabel="Load older activity" disabled={wallet.historyLoadingMore || wallet.historyLoading || wallet.offline} onPress={() => { void wallet.loadMoreHistory(); }} />
    </>}
  </>;
}
