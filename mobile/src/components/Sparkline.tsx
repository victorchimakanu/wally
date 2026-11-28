import React from 'react';
import { View } from 'react-native';
import { useMarketChart } from '../data/market';
import { chartPoints } from '../services/market-api';
import { useColors } from '../theme';

/**
 * Seven days of an asset's price as a small line, drawn the way the asset screen's chart is
 * (segments, no chart library) and in the same one colour. Decorative to a screen reader: the
 * row's price and change already say what it shows. Keeps its width while the chart loads.
 */
export function Sparkline({ id, width = 64, height = 24 }: { id: string; width?: number; height?: number }) {
  const c = useColors();
  const chart = useMarketChart(id, 7);
  const points = chartPoints(chart.data?.points ?? [], width, height - 2, 40);
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width, height, overflow: 'hidden' }}>
    {points.slice(1).map((point, index) => {
      const from = points[index], dx = point.x - from.x, dy = point.y - from.y;
      return <View key={index} style={{ position: 'absolute', left: from.x, top: from.y + 1, height: 1.5, width: Math.sqrt(dx * dx + dy * dy), backgroundColor: c.orange, transformOrigin: 'left center', transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }] }} />;
    })}
  </View>;
}
