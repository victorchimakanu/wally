import React from 'react';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { WallyAsset } from './WallyAsset';
import { Card, Label, shared } from './ui';
import { formatPrice, formatChange, type MarketAsset } from '../services/market-api';
import { useMarket } from '../data/market';
import { MarketStatus } from './MarketData';
import { colors as c } from '../theme';
import { usePreferences } from '../demo/preferences';
export function AssetLogo({ symbol }: { symbol: string }) {
  if (symbol === 'USDT') return <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#26A17B', justifyContent: 'center', alignItems: 'center' }}><Label size={24} color="#FFFFFF" weight="bold">₮</Label></View>;
  return <View style={{ width: 40, height: 40, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
    <WallyAsset name={symbol === 'BTC' ? 'bed8f.svg' : symbol === 'SOL' ? '84f09.svg' : '95c95.svg'} size={40} style={{ position: 'absolute' }} />
    {symbol === 'SOL' ? <Image source={require('../../assets/wallyui/07cc6.png')} style={{ width: 28, height: 28 }} contentFit="contain" /> : <WallyAsset name={symbol === 'BTC' ? '9df87.svg' : 'd3d24.svg'} size={24} />}
  </View>;
}
/** Opens the asset screen unless a caller, such as a chat card, handles the press. */
export function AssetRow({ asset, onPress }: { asset: MarketAsset; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`View ${asset.name}`} onPress={onPress ?? (() => router.push({ pathname: '/asset', params: { symbol: asset.symbol } }))} style={[shared.row, { minHeight: 76 }]}>
    <AssetLogo symbol={asset.symbol} /><View style={shared.flex}><Label size={16}>{asset.name}</Label><Label size={12} color={c.muted}>{asset.symbol}</Label></View><View style={{ alignItems: 'flex-end', flexShrink: 1 }}><Label size={16}>{formatPrice(asset.price, asset.currency)}</Label><Label size={12} color={asset.change === null ? c.muted : asset.change < 0 ? c.error : c.success}>{formatChange(asset.change)}</Label></View>
  </Pressable>;
}
export function Watchlist() {
  const { preferences } = usePreferences();
  const { data } = useMarket();
  const assets = data?.assets.filter(asset => preferences.saved.includes(asset.symbol)) ?? [];
  return <Card style={{ backgroundColor: c.tint, gap: 12 }}><Label size={18} weight="bold">Watchlist</Label>{assets.map(asset => <AssetRow key={asset.symbol} asset={asset} />)}{data && !assets.length && <Label color={c.muted}>Save an asset from Market to follow it here.</Label>}<Pressable accessibilityRole="button" accessibilityLabel="View all market assets" onPress={() => router.push('/market')} style={[shared.between, { minHeight: 44 }]}><Label weight="semibold">View all</Label><WallyAsset name="505db.svg" /></Pressable><MarketStatus /></Card>;
}
