import React, { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Keyboard, View } from 'react-native';
import { Card, Group, Label, LinkButton, Note, Row, Screen, useShared } from '../components/ui';
import { AssetLogo, AssetRow } from '../components/MarketRows';
import { ChatComposer } from '../components/ChatComposer';
import { Segmented } from '../components/Segmented';
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
/**
 * Four tracked assets fit on one screen, so there is nothing to search or filter, and no
 * watchlist group above them: it would repeat rows from the list it sits on. The watchlist
 * lives on the Wallet; the asset screen is where it is set.
 */
export function MarketScreen() {
  const c = useColors();
  const { data, loading, error } = useMarket();
  const assets = data?.assets ?? [];
  return <Screen title="Market" footer={<AskDock />}>
    <Group>{assets.map(asset => <AssetRow key={asset.symbol} asset={asset} />)}</Group>
    {!assets.length && <Label color={c.muted}>{loading ? 'Loading prices…' : error && !data ? 'Market data unavailable' : 'No assets'}</Label>}
    <MarketStatus refresh />
  </Screen>;
}
const TIMEFRAMES = ['1D', '1W', '1M', '1Y'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const TIMEFRAME_DAYS: Record<Timeframe, number> = { '1D': 1, '1W': 7, '1M': 30, '1Y': 365 };

export function AssetScreen() {
  const c = useColors();
  const shared = useShared();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { preferences, updatePreferences, error } = usePreferences();
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const { data, currency } = useMarket();
  const asset = data?.assets.find(item => item.symbol === symbol);
  if (!asset) return <Screen title="Market"><Note>{COINS.some(coin => coin.symbol === symbol) ? 'Loading prices…' : 'Asset not found.'}</Note><MarketStatus refresh /></Screen>;
  const saved = preferences.saved.includes(asset.symbol);
  const falling = asset.change !== null && asset.change < 0;
  // Saving sits in the title row beside the logo, as the asset boards place it, not as a
  // full-width button between the chart and the facts.
  const toggleSaved = () => updatePreferences({ saved: saved ? preferences.saved.filter(value => value !== asset.symbol) : [...preferences.saved, asset.symbol] });
  return <Screen title={asset.name} footer={<AskDock topic={asset.symbol} />}>
    <View style={shared.between}>
      <View style={{ gap: 2, flexShrink: 1 }}><Label size={32} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ lineHeight: 40 }}>{formatPrice(asset.price, currency)}</Label><Label size={14} color={asset.change === null ? c.muted : falling ? c.error : c.success}>{formatChange(asset.change)} · 24h</Label></View>
      <View style={[shared.row, { gap: 16 }]}><LinkButton label={saved ? 'Saved' : 'Save'} accessibilityLabel={saved ? 'Remove from watchlist' : 'Add to watchlist'} onPress={toggleSaved} /><AssetLogo symbol={asset.symbol} /></View>
    </View>
    <Card>
      <PriceChart id={asset.id} days={TIMEFRAME_DAYS[timeframe]} />
      <Segmented options={TIMEFRAMES} value={timeframe} onChange={setTimeframe} />
    </Card>
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
