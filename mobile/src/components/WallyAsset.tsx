import React from 'react';
import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { vectorAssets } from './wally-assets';

export type AssetName = keyof typeof vectorAssets;
/** Keep the SVG's dimensions intact; scale the containing slot proportionally. */
export function WallyAsset({ name, size, style }: { name: AssetName; size?: number; style?: StyleProp<ViewStyle> }) {
  const asset = vectorAssets[name];
  const scale = size ? size / Math.max(asset.width, asset.height) : 1;
  return <View style={[{ width: asset.width * scale, height: asset.height * scale, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, style]}>
    <Image source={asset.source} accessible={false} contentFit="contain" style={{ width: asset.width, height: asset.height, transform: [{ scale }] }} />
  </View>;
}
export function Avatar({ size = 72 }: { size?: number }) {
  return <Image source={require('../../assets/wallyui/45177.png')} accessible={false} contentFit="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />;
}
