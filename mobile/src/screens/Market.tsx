import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Keyboard, Pressable, View } from 'react-native';
import { Button, Card, Group, Label, Note, Row, Screen, useShared } from '../components/ui';
import { AssetLogo, AssetRow, Watchlist } from '../components/MarketRows';
import { ChatComposer } from '../components/ChatComposer';
import { WalletToolsModal } from '../components/ChatCards';
import { COINS, formatPrice, formatChange } from '../services/market-api';
import { useMarket } from '../data/market';
import { MarketStatus, PriceChart } from '../components/MarketData';
import { usePreferences } from '../demo/preferences';
import { useDemo } from '../demo/store';
import { useColors } from '../theme';

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
    <ChatComposer value={input} onChange={setInput} onSend={send} onTools={() => { Keyboard.dismiss(); setTools(true); }} onPrivacy={() => router.push({ pathname: '/preferences', params: { panel: 'model' } })} paused={state.aiPaused} privacy={privacy} />
    <WalletToolsModal visible={tools} onClose={() => setTools(false)} onManual={() => router.push('/send')} />
  </>;
}
/** Four tracked assets fit on one screen, so there is nothing to search or filter. */
export function MarketScreen() {
  const c = useColors();
  const { data, loading, error } = useMarket();
  const { preferences } = usePreferences();
  const assets = data?.assets ?? [];
  const watching = assets.some(asset => preferences.saved.includes(asset.symbol));
  return <Screen title="Market" footer={<AskDock />}>
    <Watchlist />
    <Group title={watching ? 'All assets' : undefined}>{assets.map(asset => <AssetRow key={asset.symbol} asset={asset} />)}</Group>
    {!assets.length && <Label color={c.muted}>{loading ? 'Loading prices…' : error && !data ? 'Market data unavailable' : 'No assets'}</Label>}
    <MarketStatus refresh />
  </Screen>;
}
export function AssetScreen() {
  const c = useColors();
  const shared = useShared();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { preferences, updatePreferences, error } = usePreferences();
  const [timeframe, setTimeframe] = useState('1D');
  const { data, currency } = useMarket();
  const asset = data?.assets.find(item => item.symbol === symbol);
  if (!asset) return <Screen title="Market"><Note>{COINS.some(coin => coin.symbol === symbol) ? 'Loading prices…' : 'Asset not found.'}</Note><MarketStatus refresh /></Screen>;
  const saved = preferences.saved.includes(asset.symbol);
  const falling = asset.change !== null && asset.change < 0;
  return <Screen title={asset.name} footer={<AskDock topic={asset.symbol} />}>
    <View style={shared.between}>
      <View style={{ gap: 2, flexShrink: 1 }}><Label size={32} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ lineHeight: 40 }}>{formatPrice(asset.price, currency)}</Label><Label size={14} color={asset.change === null ? c.muted : falling ? c.error : c.success}>{formatChange(asset.change)} · 24h</Label></View>
      <AssetLogo symbol={asset.symbol} />
    </View>
    <Card>
      <PriceChart id={asset.id} days={({ '1D': 1, '1W': 7, '1M': 30, '1Y': 365 } as Record<string, number>)[timeframe]} />
      <View style={shared.row}>{['1D', '1W', '1M', '1Y'].map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: timeframe === value }} onPress={() => setTimeframe(value)} style={{ flex: 1, borderRadius: 18, borderWidth: 1, borderColor: timeframe === value ? c.orange : c.line, backgroundColor: timeframe === value ? c.amber : c.surface, alignItems: 'center', paddingVertical: 8 }}><Label size={12}>{value}</Label></Pressable>)}</View>
    </Card>
    <Button secondary label={saved ? 'On watchlist' : 'Add to watchlist'} onPress={() => updatePreferences({ saved: saved ? preferences.saved.filter(value => value !== asset.symbol) : [...preferences.saved, asset.symbol] })} />
    <Group>
      <Row title="Market cap" value={formatPrice(asset.cap, currency, true)} />
      <Row title="24h volume" value={formatPrice(asset.volume, currency, true)} />
      <Row title="Circulating supply" value={asset.supply === null ? 'Unavailable' : `${asset.supply.toLocaleString('en-US', { notation: 'compact' })} ${asset.symbol}`} />
      <Row title="Maximum supply" value={asset.maximum === null ? 'Not reported' : `${asset.maximum.toLocaleString('en-US', { notation: 'compact' })} ${asset.symbol}`} />
    </Group>
    <MarketStatus />
    {!!error && <Note error>{error}</Note>}
  </Screen>;
}
