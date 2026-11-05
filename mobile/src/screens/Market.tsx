import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { Button, Card, Detail, Label, Note, Screen, shared } from '../components/ui';
import { AssetLogo, AssetRow, Watchlist } from '../components/MarketRows';
import { WallyAsset } from '../components/WallyAsset';
import { ChatComposer } from '../components/ChatComposer';
import { WalletToolsModal } from '../components/ChatCards';
import { COINS, formatPrice, formatChange } from '../services/market-api';
import { useMarket } from '../data/market';
import { MarketStatus, PriceChart } from '../components/MarketData';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { colors as c, fonts } from '../theme';

function AskDock({ topic }: { topic?: string }) {
  const { state, ai, newChat, sendMessage } = useDemo();
  const [input, setInput] = useState('');
  const [tools, setTools] = useState(false);
  function send() {
    const text = input.trim();
    if (!text) return;
    const id = newChat();
    Keyboard.dismiss(); setInput('');
    // When the assistant is busy the request stays as an unsent message in the new chat.
    router.push({ pathname: '/chat', params: { id, ...(topic ? { topic } : {}), ...(sendMessage(id, text) ? {} : { prompt: text }) } });
  }
  const privacy = ai.mode === 'qvac' ? ai.location === 'phone' ? 'ON THIS PHONE' : 'ON YOUR COMPUTER' : 'SCRIPTED PREVIEW';
  return <>
    <ChatComposer value={input} onChange={setInput} onSend={send} onTools={() => { Keyboard.dismiss(); setTools(true); }} onPrivacy={() => router.push({ pathname: '/preferences', params: { page: 'model' } })} paused={state.aiPaused} privacy={privacy} />
    <WalletToolsModal visible={tools} onClose={() => setTools(false)} onManual={() => router.push('/send')} />
  </>;
}
export function MarketScreen() {
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState(params.filter === 'Trends' ? 'Trends' : 'All assets');
  const [search, setSearch] = useState('');
  const { data, loading, error } = useMarket();
  const all = data?.assets ?? [];
  const assets = all.filter(asset => (filter !== 'Stablecoins' || asset.symbol === 'USDT') && (filter !== 'Gainers' || asset.change !== null && asset.change > 0) && (asset.name + asset.symbol).toLowerCase().includes(search.toLowerCase())).sort((a, b) => filter === 'Trends' || filter === 'Gainers' ? (b.change ?? -Infinity) - (a.change ?? -Infinity) : 0);
  return <Screen title="Market" footer={<AskDock />}>
    <Card style={{ backgroundColor: c.successTint }}><Label size={18} weight="bold">Market pulse</Label><Label size={16}>{data ? `${all.filter(asset => asset.change !== null && asset.change > 0).length} of ${all.length} tracked assets are up over 24h.` : 'Fetching current prices and market activity.'}</Label><MarketStatus refresh /></Card>
    <View style={[shared.row, shared.input]}><WallyAsset name="ddc2c.svg" /><TextInput accessibilityLabel="Search market assets" value={search} onChangeText={setSearch} placeholder="Search assets" placeholderTextColor={c.muted} style={{ flex: 1, fontSize: 16, fontFamily: fonts.regular, color: c.ink }} /></View>
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>{['All assets', 'Gainers', 'Stablecoins', 'Trends'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: value === filter }} onPress={() => setFilter(value)} style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: value === filter ? c.ink : c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line }}><Label size={12} color={value === filter ? c.surface : c.ink}>{value}</Label></Pressable>)}</View>
    {!search && filter === 'All assets' && <Watchlist />}
    <Label size={18} weight="bold">{filter === 'Trends' || filter === 'Gainers' ? 'Top movers · 24h' : 'Explore assets'}</Label>
    {assets.map(asset => <AssetRow key={asset.symbol} asset={asset} />)}
    {!assets.length && <Card><Label weight="semibold">{loading ? 'Loading assets…' : error && !data ? 'Market data unavailable' : 'No matching assets'}</Label><Note>{filter === 'Gainers' ? 'Only assets with positive 24h performance appear here.' : 'Try Bitcoin, Ethereum, Solana or Tether.'}</Note></Card>}
  </Screen>;
}
export function AssetScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { preferences, updatePreferences, error } = usePreferences();
  const { newChat } = useDemo();
  const [timeframe, setTimeframe] = useState('1D');
  const { data, currency } = useMarket();
  const asset = data?.assets.find(item => item.symbol === symbol);
  if (!asset) return <Screen title="Market"><Note>{COINS.some(coin => coin.symbol === symbol) ? 'Fetching asset data. Previously fetched prices will appear when available.' : 'Asset not found.'}</Note><MarketStatus refresh /><Button label="Browse assets" onPress={() => router.replace('/market')} /></Screen>;
  const saved = preferences.saved.includes(asset.symbol);
  return <Screen title="Market" footer={<AskDock topic={asset.symbol} />}>
    <View style={shared.between}><View><Label size={25} weight="semibold">{asset.name}</Label><Note>{asset.symbol} · Price and performance</Note></View><AssetLogo symbol={asset.symbol} /></View>
    <Card><View style={shared.between}><Label weight="medium">{asset.symbol} / {currency}</Label><Note>24H</Note></View><Label size={28} weight="semibold">{formatPrice(asset.price, currency)}</Label><Label size={12} color={asset.change !== null && asset.change < 0 ? c.error : c.success}>{formatChange(asset.change)} over 24h</Label>
      <PriceChart id={asset.id} days={({ '1D': 1, '1W': 7, '1M': 30, '1Y': 365 } as Record<string, number>)[timeframe]} />
      <View style={shared.row}>{['1D', '1W', '1M', '1Y'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: timeframe === value }} onPress={() => setTimeframe(value)} style={{ flex: 1, borderRadius: 18, borderWidth: 1, borderColor: timeframe === value ? c.orange : c.line, backgroundColor: timeframe === value ? c.amber : c.surface, alignItems: 'center', paddingVertical: 8 }}><Label size={12}>{value}</Label></Pressable>)}</View><MarketStatus />
    </Card>
    <View style={shared.row}><Button secondary label={saved ? 'Saved' : 'Save'} style={shared.flex} onPress={() => updatePreferences({ saved: saved ? preferences.saved.filter(value => value !== asset.symbol) : [...preferences.saved, asset.symbol] })} /><Button accent label="Ask Wally" style={shared.flex} onPress={() => router.push({ pathname: '/chat', params: { id: newChat(), topic: asset.symbol } })} /></View>
    <Card><Label size={18} weight="bold">Market facts</Label><Detail label="Market cap" value={formatPrice(asset.cap, currency, true)} /><Detail label="24h volume" value={formatPrice(asset.volume, currency, true)} /><Detail label="Circulating supply" value={asset.supply === null ? 'Unavailable' : `${asset.supply.toLocaleString('en-US', { notation: 'compact' })} ${asset.symbol}`} /><Detail label="Maximum supply" value={asset.maximum === null ? 'Not reported' : `${asset.maximum.toLocaleString('en-US', { notation: 'compact' })} ${asset.symbol}`} /><Note>CoinGecko · {asset.updatedAt ? `Provider updated ${new Date(asset.updatedAt).toLocaleString()}` : 'Provider timestamp unavailable'}</Note></Card>
    <Card style={{ backgroundColor: c.tint }}><Label weight="medium">Market asset</Label><Label color={c.muted}>Market prices describe traded assets. Testnet tokens have no monetary value.</Label></Card>
    {!!error && <Note error>{error}</Note>}
  </Screen>;
}
