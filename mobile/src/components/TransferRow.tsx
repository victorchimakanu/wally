import React from 'react';
import { Pressable, View } from 'react-native';
import { Label, useShared } from './ui';
import { useColors } from '../theme';

/**
 * One transfer in a list: who, then its state and network; the amount, then when. The same
 * row on the Wallet's recent activity and on Activity, inside a `Group`, so a transfer looks
 * the same wherever it turns up. The Figma `activity/transaction-row` without its icon.
 */
export function TransferRow({ title, meta, amount, when, failed = false, onPress }: { title: string; meta: string; amount: string; when?: string; failed?: boolean; onPress?: () => void }) {
  const c = useColors();
  const shared = useShared();
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${amount}, ${meta}${when ? `, ${when}` : ''}`} disabled={!onPress} onPress={onPress} style={({ pressed }) => [shared.row, { minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 }, pressed && { backgroundColor: c.toggle }]}>
    <View style={[shared.flex, { gap: 2 }]}><Label size={16} numberOfLines={1}>{title}</Label><Label size={13} color={failed ? c.error : c.muted} numberOfLines={1}>{meta}</Label></View>
    <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0 }}><Label size={16} numberOfLines={1}>{amount}</Label>{!!when && <Label size={13} color={c.muted}>{when}</Label>}</View>
  </Pressable>;
}
