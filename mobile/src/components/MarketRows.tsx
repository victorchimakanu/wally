import React from 'react';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { WallyAsset } from './WallyAsset';
import { Sparkline } from './Sparkline';
import { Group, Label, useShared } from './ui';
import { formatPrice, formatChange, type MarketAsset } from '../services/market-api';
import { useMarket } from '../data/market';
import { useColors, useTheme } from '../theme';
import { usePreferences } from '../demo/preferences';
/**
 * In light mode the Figma pastel discs carry an ink glyph. In dark mode those discs would glare
 * and the glyph would go paper, so the disc takes the palette's deep tint and the glyph the
 * asset's own colour: amber for Bitcoin, lilac for Ethereum and Solana.
 */
export function AssetLogo({ symbol }: { symbol: string }) {
  const { palette: c, dark } = useTheme();
  if (symbol === 'USDT') return <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#26A17B', justifyContent: 'center', alignItems: 'center' }}><Label size={24} color="#FFFFFF" weight="bold">₮</Label></View>;
  const disc = dark ? (symbol === 'BTC' ? c.amber : c.tint) : undefined;
  const glyph = dark ? (symbol === 'BTC' ? c.orange : c.lilac) : undefined;
  return <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: disc, justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
    {!dark && <WallyAsset name={symbol === 'BTC' ? 'bed8f.svg' : symbol === 'SOL' ? '84f09.svg' : '95c95.svg'} size={40} style={{ position: 'absolute' }} />}
    {symbol === 'SOL' ? <Image source={require('../../assets/wallyui/07cc6.png')} style={{ width: 28, height: 28 }} contentFit="contain" /> : <WallyAsset name={symbol === 'BTC' ? '9df87.svg' : 'd3d24.svg'} size={24} color={glyph} />}
  </View>;
}
/** The widths of the Market table's columns past the name, shared with its caption row. */
export const MARKET_COLUMNS = { figure: 96, price: 112 };

/**
 * Opens the asset screen unless a caller, such as a chat card, handles the press. `spark` adds
 * the week's line before the price; `detail` adds market cap and 24h volume as columns, for the
 * widths that have room for a table.
 */
export function AssetRow({ asset, onPress, spark = false, detail = false }: { asset: MarketAsset; onPress?: () => void; spark?: boolean; detail?: boolean }) {
  const c = useColors();
  const shared = useShared();
  return <Pressable accessibilityRole="button" accessibilityLabel={`View ${asset.name}`} onPress={onPress ?? (() => router.push({ pathname: '/asset', params: { symbol: asset.symbol } }))} style={({ pressed }) => [shared.row, { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 }, pressed && { backgroundColor: c.toggle }]}>
    <AssetLogo symbol={asset.symbol} /><Label size={16} style={shared.flex} numberOfLines={1}>{asset.name}</Label>
    {spark && <Sparkline id={asset.id} />}
    {detail && <><Label size={15} color={c.muted} style={{ width: MARKET_COLUMNS.figure, textAlign: 'right' }}>{formatPrice(asset.cap, asset.currency, true)}</Label><Label size={15} color={c.muted} style={{ width: MARKET_COLUMNS.figure, textAlign: 'right' }}>{formatPrice(asset.volume, asset.currency, true)}</Label></>}
    <View style={[{ alignItems: 'flex-end', flexShrink: 1 }, detail && { width: MARKET_COLUMNS.price }]}><Label size={16}>{formatPrice(asset.price, asset.currency)}</Label><Label size={12} color={asset.change === null ? c.muted : asset.change < 0 ? c.error : c.success}>{formatChange(asset.change)}</Label></View>
  </Pressable>;
}
/** Saved assets, or nothing: an empty watchlist is not worth a card explaining how to fill it. */
export function Watchlist() {
  const { preferences } = usePreferences();
  const { data } = useMarket();
  const assets = data?.assets.filter(asset => preferences.saved.includes(asset.symbol)) ?? [];
  return <Group title="Watchlist">{assets.map(asset => <AssetRow key={asset.symbol} asset={asset} />)}</Group>;
}
