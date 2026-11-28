import React, { useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { WallyAsset } from './WallyAsset';
import { Label, LinkButton, useShared } from './ui';
import { useColors, useTheme } from '../theme';

/** What hangs under the card: the latest thing worth knowing, and the one way to act on it. */
export type WalletTab = {
  title: string;
  meta?: string;
  /** A text action on the right, such as Refresh. A tab with one is not pressable itself. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  /** Without an action, a pressable tab shows a chevron and opens somewhere. */
  onPress?: () => void;
  /** Announce the tab when it changes, for the one case where it carries a problem. */
  alert?: boolean;
};

/**
 * The wallet's hero, from the Home boards: the lilac card with the balance in it, and the tab
 * hanging under it that says the latest thing worth knowing — the last transfer, or why the
 * figure is a dash. Demo and live wallets draw the same card, so a wallet that cannot reach
 * its server still looks like a wallet rather than a stack of notices. The title's chevron
 * expands `children`: the balances behind the total.
 *
 * Drawn at the board's 384 × 238 and scaled to the column it is given, which keeps the artwork
 * and the type in proportion on a phone.
 */
export function WalletCard({ amount, unit, line, lineLabel, tab, inline = false, children }: React.PropsWithChildren<{ amount: string; unit: string; line?: string; lineLabel?: string; tab?: WalletTab;
  /** In a chat answer: the bare card at its own width, no avatar notch and no tab. */
  inline?: boolean }>) {
  const c = useColors();
  const { dark } = useTheme();
  const shared = useShared();
  const [width, setWidth] = useState(384);
  const [expanded, setExpanded] = useState(false);
  const scale = width / 384;
  const pressable = !!tab?.onPress;
  // The board's body artwork has the notch cut for the avatar; the bare card paints the same
  // lilac on a plain rounded body and keeps only the two discs.
  return <View style={[{ gap: 12 }, inline && { maxWidth: 384 }]}>
    <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: (inline ? 224 : 238) * scale }}>
      <View style={{ width: 384, height: 238, position: 'absolute', top: inline ? -13.4 * scale : 0, transformOrigin: 'top left', transform: [{ scale }] }}>
        <View style={{ position: 'absolute', top: 13.4, width: 384, height: 223.439, overflow: 'hidden', borderRadius: 22.326, backgroundColor: inline && !dark ? c.lilac : c.tint }}>
          {!dark && <>
            {!inline && <WallyAsset name="6a869.svg" />}
            <WallyAsset name="d7e4c.svg" style={{ position: 'absolute', left: 324.49, top: 5.61, opacity: .55 }} />
            <WallyAsset name="27e99.svg" style={{ position: 'absolute', left: -150.46, top: 5.61, opacity: .55 }} />
          </>}
        </View>
        {!inline && <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={{ position: 'absolute', left: 165.05, top: 2.23, width: 53.895, height: 53.895, borderRadius: 27, overflow: 'hidden' }}>
          <Image source={require('../../assets/wallyui/9b60e.png')} accessible={false} contentFit="cover" style={{ position: 'absolute', left: -37.726, top: 0, width: 139.436, height: 92.968 }} />
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Collapse wallet balances' : 'Expand wallet balances'} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ position: 'absolute', top: 72, left: 26.79, width: 330.419, height: 146, alignItems: 'center', gap: 9 }}>
          <View style={[shared.row, { width: '100%', paddingHorizontal: 8, gap: 9 }]}>
            <View style={{ width: 18 }} />
            <Label size={17.86} style={{ flex: 1, textAlign: 'center', lineHeight: 25.67 }}>Personal wallet</Label>
            <WallyAsset name="e353f.svg" size={18} style={{ transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }} />
          </View>
          <View style={[shared.row, { gap: 9 }]}><Label size={40.186} weight="semibold" adjustsFontSizeToFit numberOfLines={1} style={{ lineHeight: 46.884, maxWidth: 282 }}>{amount}</Label><Label size={13.395} weight="medium">{unit}</Label></View>
          {!!line && <Label size={13.395} weight="medium" numberOfLines={1} accessibilityLabel={lineLabel}>{line}</Label>}
        </Pressable>
      </View>
    </View>
    {tab && (() => {
      // A tab with its own text action is not itself a button: the web would nest one in another.
      const style = { marginTop: -16, marginHorizontal: 26 * scale, backgroundColor: dark ? c.surface : c.tint, borderBottomLeftRadius: 20, borderBottomRightRadius: 20, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 18, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
      const text = <View style={[shared.flex, { gap: 1 }]}>
        <Label size={14} weight="medium" numberOfLines={1}>{tab.title}</Label>
        {!!tab.meta && <Label size={12} color={c.muted} numberOfLines={3}>{tab.meta}</Label>}
      </View>;
      const label = `${tab.title}${tab.meta ? `. ${tab.meta}` : ''}`;
      return tab.action
        ? <View accessible accessibilityLabel={label} accessibilityLiveRegion={tab.alert ? 'polite' : 'none'} style={style}>{text}<LinkButton label={tab.action.label} disabled={tab.action.disabled} onPress={tab.action.onPress} /></View>
        : <Pressable accessibilityRole={pressable ? 'button' : undefined} accessibilityLabel={label} accessibilityLiveRegion={tab.alert ? 'polite' : 'none'} disabled={!pressable} onPress={tab.onPress} style={({ pressed }) => [style, pressed && { opacity: .7 }]}>{text}{pressable && <WallyAsset name="7da25.svg" />}</Pressable>;
    })()}
    {expanded && children}
  </View>;
}
