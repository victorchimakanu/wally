import React from 'react';
import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { vectorAssets } from './wally-assets';
import { useTheme } from '../theme';

export type AssetName = keyof typeof vectorAssets;
/**
 * Keep the SVG's dimensions intact; scale the containing slot proportionally.
 * Single-colour neutral icons (`tone` in the registry) take the palette's colour in dark mode.
 * `tint={false}` keeps the original on a surface that stays light whatever the theme.
 */
export function WallyAsset({ name, size, style, tint = true, color }: { name: AssetName; size?: number; style?: StyleProp<ViewStyle>; tint?: boolean; /** Paints a single-colour icon in this colour instead of the palette's. */ color?: string }) {
  const { palette, dark } = useTheme();
  const asset = vectorAssets[name];
  const scale = size ? size / Math.max(asset.width, asset.height) : 1;
  const tintColor = color ?? (dark && tint && asset.tone ? palette[asset.tone] : undefined);
  return <View style={[{ width: asset.width * scale, height: asset.height * scale, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, style]}>
    <Image source={asset.source} tintColor={tintColor} accessible={false} contentFit="contain" style={{ width: asset.width, height: asset.height, transform: [{ scale }] }} />
  </View>;
}
/** The lockup in the colourway that reads on the current background; `onBrand` flips it for a brand-coloured surface. */
export function Lockup({ size, style, onBrand = false }: { size?: number; style?: StyleProp<ViewStyle>; onBrand?: boolean }) {
  const { dark } = useTheme();
  return <WallyAsset name={dark !== onBrand ? 'wally-lockup-dark.svg' : 'wally-lockup-light.svg'} size={size} style={style} tint={false} />;
}
export function Avatar({ size = 72 }: { size?: number }) {
  return <Image source={require('../../assets/wallyui/45177.png')} accessible={false} contentFit="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />;
}
