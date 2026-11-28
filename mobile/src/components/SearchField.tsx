import React from 'react';
import { TextInput, View } from 'react-native';
import { WallyAsset } from './WallyAsset';
import { useShared } from './ui';
import { fonts, useColors } from '../theme';

/** The one search field: a magnifier and a plain input on the card surface, as the list screens draw it. */
export function SearchField({ value, onChange, accessibilityLabel }: { value: string; onChange: (value: string) => void; accessibilityLabel: string }) {
  const c = useColors();
  const shared = useShared();
  return <View style={[shared.row, shared.input]}>
    <WallyAsset name="ddc2c.svg" />
    <TextInput accessibilityLabel={accessibilityLabel} placeholder="Search" placeholderTextColor={c.muted} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, fontFamily: fonts.regular, fontSize: 16, color: c.ink }} />
  </View>;
}
