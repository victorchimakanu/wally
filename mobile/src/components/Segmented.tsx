import React from 'react';
import { Pressable, View } from 'react-native';
import { Label } from './ui';
import { useColors } from '../theme';

/**
 * One choice among a few, on the same track the Wallet/Chat switch uses: a toggle-coloured
 * track with the chosen segment raised. For the Asset screen's timeframes and Activity's
 * All/Sent/Received, so the app has one segmented control rather than a pill style per screen.
 */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T; onChange: (value: T) => void; label?: (option: T) => string }) {
  const c = useColors();
  return <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.toggle, borderRadius: 24, padding: 4 }}>
    {options.map(option => {
      const selected = option === value;
      return <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => onChange(option)} style={{ flex: 1, minHeight: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.raised : 'transparent' }}>
        <Label size={14} weight={selected ? 'semibold' : 'regular'}>{label ? label(option) : option}</Label>
      </Pressable>;
    })}
  </View>;
}
