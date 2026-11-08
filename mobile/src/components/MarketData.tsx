import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Note, shared } from './ui';
import { useMarket, useMarketChart } from '../data/market';
import { chartPoints } from '../services/market-api';
import { colors as c } from '../theme';
export function MarketStatus({ refresh = false }: { refresh?: boolean }) {
  const market = useMarket();
  return <View style={{ gap: 8 }}><Note>{market.loading ? 'Refreshing market data…' : market.data ? `${market.stale ? 'Saved' : 'Latest fetched'} prices · ${market.currency} · Updated ${new Date(market.data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : market.offline ? 'No saved market prices for this currency.' : 'Loading market data…'}</Note>{!!market.error && <Note error>{market.error}</Note>}<Note>Market data: CoinGecko · Wallet funds remain separate.</Note>{refresh && <Button secondary label="Refresh market data" disabled={market.loading || market.offline} onPress={market.refresh} />}</View>;
}
export function PriceChart({ id, days }: { id: string; days: number }) {
  const chart = useMarketChart(id, days);
  const [width, setWidth] = useState(280);
  const points = chartPoints(chart.data?.points ?? [], Math.max(0, width - 8), 132);
  const up = !chart.data || chart.data.points.at(-1)![1] >= chart.data.points[0][1];
  const line = up ? c.success : c.error;
  return <View style={{ gap: 8 }}>{chart.data ? <><View accessibilityRole="image" accessibilityLabel={`${days}-day price chart from CoinGecko, ${chart.data.points.length} observations`} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: 148, marginVertical: 12, overflow: 'hidden' }}>{points.slice(1).map((point, index) => { const from = points[index], dx = point.x - from.x, dy = point.y - from.y; return <View key={index} style={{ position: 'absolute', left: from.x + 4, top: from.y + 6, height: 2, width: Math.sqrt(dx * dx + dy * dy), backgroundColor: line, transformOrigin: 'left center', transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }} />; })}</View><View style={shared.between}><Note>{new Date(chart.data.points[0][0]).toLocaleDateString()}</Note><Note>{new Date(chart.data.points.at(-1)![0]).toLocaleDateString()}</Note></View><Note>{chart.stale ? 'Saved chart' : 'Fetched chart'} · {chart.data.currency} · {days} day{days > 1 ? 's' : ''}</Note></> : <View style={{ minHeight: 148, justifyContent: 'center' }}><Note>{chart.loading ? 'Loading price history…' : 'No price history is available.'}</Note></View>}{!!chart.error && <Note error>{chart.error}</Note>}{!!chart.error && <Button secondary label="Retry chart" disabled={chart.loading} onPress={chart.refresh} />}</View>;
}
