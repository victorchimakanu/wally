import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, LinkButton, Note, useShared } from './ui';
import { useMarket, useMarketChart } from '../data/market';
import { chartPoints } from '../services/market-api';
import { useColors } from '../theme';
export function MarketStatus({ refresh = false }: { refresh?: boolean }) {
  const shared = useShared();
  const market = useMarket();
  // One line: the source (CoinGecko asks to be credited) and how fresh the prices are.
  const status = market.loading ? 'Updating prices…' : market.data ? `CoinGecko · ${market.stale ? 'Saved' : 'Updated'} ${new Date(market.data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : market.offline ? 'No saved prices for this currency' : 'Loading prices…';
  return <View style={{ gap: 4 }}><View style={shared.between}><Note>{status}</Note>{refresh && <LinkButton label="Refresh" accessibilityLabel="Refresh prices" disabled={market.loading || market.offline} onPress={market.refresh} />}</View>{!!market.error && <Note error>{market.error}</Note>}</View>;
}
export function PriceChart({ id, days }: { id: string; days: number }) {
  const c = useColors();
  const shared = useShared();
  const chart = useMarketChart(id, days);
  const [width, setWidth] = useState(280);
  const points = chartPoints(chart.data?.points ?? [], Math.max(0, width - 8), 132);
  // One colour for the line, as the asset boards draw it; the 24h figure above the chart
  // already carries the sign, and a whole card turning error-red for a down day shouts.
  const line = c.orange;
  return <View style={{ gap: 8 }}>{chart.data ? <><View accessibilityRole="image" accessibilityLabel={`${days}-day price chart from CoinGecko, ${chart.data.points.length} observations`} onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: 148, marginVertical: 12, overflow: 'hidden' }}>{points.slice(1).map((point, index) => { const from = points[index], dx = point.x - from.x, dy = point.y - from.y; return <View key={index} style={{ position: 'absolute', left: from.x + 4, top: from.y + 6, height: 2, width: Math.sqrt(dx * dx + dy * dy), backgroundColor: line, transformOrigin: 'left center', transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }} />; })}</View><View style={shared.between}><Note>{new Date(chart.data.points[0][0]).toLocaleDateString()}</Note><Note>{new Date(chart.data.points.at(-1)![0]).toLocaleDateString()}</Note></View></> : <View style={{ minHeight: 148, justifyContent: 'center' }}><Note>{chart.loading ? 'Loading price history…' : 'No price history is available.'}</Note></View>}{!!chart.error && <Note error>{chart.error}</Note>}{!!chart.error && <Button secondary label="Retry chart" disabled={chart.loading} onPress={chart.refresh} />}</View>;
}
