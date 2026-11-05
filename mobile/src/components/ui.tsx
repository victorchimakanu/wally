import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { Avatar, WallyAsset } from './WallyAsset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { colors as c, fonts, radius } from '../theme';
import { useDemo } from '../demo/store';
import { useWallet } from '../data/wallet';
import { usePreferences } from '../demo/preferences';

const icons = {
  back: require('../../assets/figma/22421.svg'), spark: require('../../assets/figma/2c6cd.svg'),
  sparkSmall: require('../../assets/figma/2c02c.svg'), sparkWhite: require('../../assets/figma/82691.svg'),
  send: require('../../assets/figma/42872.svg'), shield: require('../../assets/figma/d7674.svg'),
  clock: require('../../assets/figma/3d32e.svg'), clockSmall: require('../../assets/figma/d1b31.svg'),
  expired: require('../../assets/figma/f00f4.svg'), check: require('../../assets/figma/3655b.svg'),
  confirmed: require('../../assets/figma/6d0e4.svg'), receive: require('../../assets/figma/5a6d5.svg'),
  wallet: require('../../assets/figma/ebc35.svg'), walletMuted: require('../../assets/figma/e91fb.svg'),
  chats: require('../../assets/figma/65b37.svg'), chatsMuted: require('../../assets/figma/43aa9.svg'),
  settings: require('../../assets/figma/6d3fd.svg'), settingsMuted: require('../../assets/figma/d3bc8.svg'),
  offline: require('../../assets/figma/757d9.svg'), system: require('../../assets/figma/64547.svg'),
};
export type IconName = keyof typeof icons;
/** Unmodified Figma SVGs rendered at their original dimensions. */
export function Icon({ name }: { name: IconName }) {
  const size = name === 'receive' ? 62 : ['clock', 'expired', 'confirmed'].includes(name) ? 44 : name === 'sparkSmall' ? 20 : 24;
  return <Image source={icons[name]} contentFit="contain" style={{ width: name === 'system' ? 66.662 : size, height: name === 'system' ? 11.334 : size }} accessible={false} />;
}
export function Label({ children, size = 14, weight = 'regular', color = c.ink, style, ...props }: TextProps & { size?: number; weight?: keyof typeof fonts; color?: string }) {
  return <Text {...props} style={[{ fontFamily: fonts[weight], color, fontSize: size, lineHeight: Math.round(size * 1.5) }, style]}>{children}</Text>;
}
export function Button({ label, onPress, secondary = false, accent = false, disabled = false, style }: { label: string; onPress: () => void; secondary?: boolean; accent?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: accent ? c.yellow : secondary ? c.surface : c.brand, borderWidth: secondary ? 1 : 0, borderColor: c.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
    <Label size={16} weight="semibold" color={secondary || accent ? c.ink : c.surface} style={s.center}>{label}</Label>
  </Pressable>;
}
export function Card({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { return <View style={[s.card, style]}>{children}</View>; }
export function Pill({ children, tone = 'brand' }: React.PropsWithChildren<{ tone?: 'brand' | 'warning' | 'success' }>) {
  return <View style={[s.pill, { backgroundColor: tone === 'warning' ? c.warningTint : tone === 'success' ? c.successTint : c.tint }]}>
    <Label size={11} weight="medium" color={tone === 'warning' ? c.warning : tone === 'success' ? c.success : c.brand}>{children}</Label>
  </View>;
}
export function Note({ children, error = false }: React.PropsWithChildren<{ error?: boolean }>) {
  return <Label size={12} color={error ? c.error : c.muted} accessibilityLiveRegion={error ? 'polite' : 'none'} style={error ? s.error : undefined}>{children}</Label>;
}
export function Header({ title, subtitle, back = true }: { title: string; subtitle?: string; back?: boolean }) {
  return <View style={s.header}>
    {back && <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/wallet')} style={s.back}><View style={{ transform: [{ rotate: '180deg' }] }}><WallyAsset name="afc43.svg" /></View></Pressable>}
    <View style={{ flex: 1, alignItems: 'center', paddingRight: back ? 50 : 0 }}><Label weight="semibold" size={16} accessibilityRole="header">{title}</Label>{subtitle && <Label size={11} color={c.muted} style={shared.center}>{subtitle}</Label>}</View>
  </View>;
}
/** `floating` drops the Wallet/Chat switch and keeps only the menu button, floating over the content. */
export function AppNavigation({ surface, floating = false }: { surface: 'wallet' | 'chat'; floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const { state, newChat } = useDemo();
  const { preferences } = usePreferences();
  const insets = useSafeAreaInsets();
  function chat(fresh = false) { const id = fresh ? newChat() : state.chats[0]?.id ?? newChat(); setOpen(false); router.replace({ pathname: '/chat', params: { id } }); }
  function go(path: '/wallet' | '/chats' | '/history' | '/market' | '/settings' | '/profile' | '/address-book') { setOpen(false); router.push(path); }
  const menu = <Pressable accessibilityRole="button" accessibilityLabel="Open app menu" onPress={() => setOpen(true)} style={[s.menu, floating && s.floatingShadow]}><WallyAsset name="f3b34.svg" /></Pressable>;
  return <>
    {floating ? <Animated.View entering={FadeIn.duration(200)} style={s.floatingMenu}>{menu}</Animated.View> : <View style={s.navigation}>
      {menu}
      <View style={s.segment}>{(['wallet', 'chat'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'wallet' ? 'Wallet' : 'Chat'} accessibilityState={{ selected: surface === value }} onPress={() => value === 'wallet' ? router.replace('/wallet') : chat()} style={[s.segmentButton, surface === value && { backgroundColor: c.surface }]}><Label size={17} weight={surface === value ? 'semibold' : 'regular'}>{value === 'wallet' ? 'Wallet' : 'Chat'}</Label></Pressable>)}</View>
    </View>}
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss app menu" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[s.drawer, { paddingTop: Math.max(insets.top, 24) + 32, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
            <View style={shared.between}><WallyAsset name="wally-lockup-light.svg" size={120} /><Pressable accessibilityRole="button" accessibilityLabel="Close app menu" onPress={() => setOpen(false)} style={s.iconButton}><WallyAsset name="9e528.svg" /></Pressable></View>
            <Button label="New chat" onPress={() => chat(true)} />
            <View>{([['Wallet', 'bfa3b.svg', '/wallet'], ['Chats', '49ec3.svg', '/chats'], ['Activity', 'b1b14.svg', '/history'], ['Market', '56a25.svg', '/market']] as const).map(([label, icon, path]) => <Pressable key={path} accessibilityRole="button" onPress={() => go(path)} style={s.drawerRow}><WallyAsset name={icon} size={24} /><Label size={16} weight="medium">{label}</Label></Pressable>)}</View>
            <Label size={12} color={c.muted}>Recent chats</Label>
            {state.chats.slice(0, 3).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => { setOpen(false); router.push({ pathname: '/chat', params: { id: item.id } }); }} style={{ paddingVertical: 8, gap: 4 }}><Label numberOfLines={1}>{item.title}</Label><Label size={12} color={c.muted}>{item.messages.length} messages · Saved locally</Label></Pressable>)}
            <Divider />
            <Pressable accessibilityRole="button" onPress={() => go('/address-book')} style={s.drawerRow}><WallyAsset name="9a2cd.svg" /><Label>Address book</Label></Pressable>
            <Pressable accessibilityRole="button" onPress={() => go('/settings')} style={s.drawerRow}><WallyAsset name="f2470.svg" /><Label>Settings</Label></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => go('/profile')} style={[s.drawerRow, { backgroundColor: c.tint, borderRadius: 22, padding: 16 }]}><Avatar size={44} /><View><Label weight="semibold">{preferences.name}</Label><Label size={12} color={c.muted}>View profile</Label></View></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
/** Messages fade out under the floating menu instead of sliding beneath a hard edge. */
// Stepped bands rather than a gradient style, which is still experimental on native.
const FADE_STEPS = [1, .86, .7, .54, .38, .24, .12, .04];
export function Screen({ children, title, subtitle, tab, surface, immersive = false, footer, back = true, contentStyle, autoScroll = false, fixedHeader, scrollRequest, onScrollActivity, onNearBottomChange, onViewportHeightChange }: React.PropsWithChildren<{ title?: string; subtitle?: string; tab?: 'wallet' | 'chats' | 'settings'; surface?: 'wallet' | 'chat'; immersive?: boolean; footer?: React.ReactNode; back?: boolean; contentStyle?: StyleProp<ViewStyle>; autoScroll?: boolean; fixedHeader?: React.ReactNode; scrollRequest?: string | number; onScrollActivity?: () => void; onNearBottomChange?: (near: boolean) => void; onViewportHeightChange?: (height: number) => void }>) {
  const scroll = useRef<ScrollView>(null);
  // autoScroll keeps the newest content locked to the bottom, as in a chat, until the user scrolls away.
  const following = useRef(true);
  // The first scroll is instant; later sends and replies glide instead of jumping.
  const glide = useRef(false);
  const gliding = useRef(0);
  useEffect(() => { const timer = setTimeout(() => { glide.current = true; }, 400); return () => clearTimeout(timer); }, []);
  function toLatest(animated = glide.current) { if (animated) gliding.current = Date.now(); scroll.current?.scrollToEnd({ animated }); }
  useEffect(() => {
    if (!autoScroll) return;
    following.current = true;
    gliding.current = Date.now();
    onNearBottomChange?.(true);
    const frame = requestAnimationFrame(() => toLatest());
    return () => cancelAnimationFrame(frame);
    // A new conversation or an explicit send/jump resumes following the latest reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest, autoScroll]);
  const insets = useSafeAreaInsets();
  const { state, storageError } = useDemo();
  const wallet = useWallet();
  return <View style={[s.screen, surface === 'chat' && { width: '100%', maxWidth: 928, alignSelf: 'center' }, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
    {Platform.OS === 'web' && <View style={s.status}><Text style={{ fontWeight: '600', fontSize: 15, color: '#333' }}>9:41</Text><Icon name="system" /></View>}
    <KeyboardAvoidingView style={[s.flex, { minHeight: 0 }]} onLayout={event => onViewportHeightChange?.(event.nativeEvent.layout.height)} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      {(surface || tab === 'wallet') ? <AppNavigation surface={surface ?? 'wallet'} floating={immersive} /> : title && <Header title={title} subtitle={subtitle} back={back} />}
      {fixedHeader}
      <ScrollView ref={scroll} style={{ flex: 1, minHeight: 0 }} scrollEventThrottle={32} onScroll={event => {
        onScrollActivity?.();
        if (!autoScroll) return;
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const near = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
        // Offsets passed during our own glide are not the user leaving the latest message.
        if (!near && Date.now() - gliding.current < 800) return;
        if (near !== following.current) { following.current = near; onNearBottomChange?.(near); }
      }} onContentSizeChange={() => { if (autoScroll && following.current) toLatest(); }} onLayout={() => { if (autoScroll && following.current) toLatest(false); }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, contentStyle]}>
        {storageError ? <Note error>{storageError}</Note> : null}
        {state.offline && tab && <Pill tone="warning">Offline preview · cached balances</Pill>}
        {children}
      </ScrollView>
      {immersive && <View style={s.fade}>{FADE_STEPS.map(opacity => <View key={opacity} style={{ flex: 1, backgroundColor: c.background, opacity }} />)}</View>}
      {footer && <View style={s.footer}>{footer}</View>}
    </KeyboardAvoidingView>
    <View style={s.demoBar}><Label size={10} color={c.muted}>{wallet.enabled ? 'TESTNET · Real chain data · Tokens have no monetary value' : 'DEMO · Fictional funds · No transactions sent'}</Label></View>
    {Platform.OS === 'web' ? <View style={[s.gestureArea, { backgroundColor: tab ? c.surface : c.background }]}><View style={s.gesture} /></View> : <View style={{ height: insets.bottom, backgroundColor: tab ? c.surface : c.background }} />}
  </View>;
}
export function Item({ icon, title, subtitle, onPress, right }: { icon: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode }) {
  const content = <><View style={s.iconWell}><Icon name={icon} /></View><View style={s.flex}><Label weight="medium">{title}</Label>{subtitle && <Label size={11} color={c.muted}>{subtitle}</Label>}</View>{right}</>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.item, { opacity: pressed ? .7 : 1 }]}>{content}</Pressable> : <View style={s.item}>{content}</View>;
}
export function Detail({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <View style={s.detail}><Label size={emphasis ? 14 : 12} color={emphasis ? c.ink : c.muted} style={{ flex: 1 }}>{label}</Label><Label size={emphasis ? 16 : 13} weight={emphasis ? 'semibold' : 'medium'} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Label></View>;
}
export function Divider() { return <View style={s.divider} />; }
export function Address({ value }: { value: string }) { return <Label selectable weight="medium" style={{ overflowWrap: 'anywhere' } as TextStyle}>{value}</Label>; }
/** Frames a receive QR code in a bordered tile so it reads as one scannable object. */
export function QrTile({ children }: React.PropsWithChildren) { return <View style={s.qrTile}>{children}</View>; }
/** A receive address in two balanced lines, first and last characters emphasised for checking. Tapping copies the exact address. */
export function ReceiveAddress({ value, onCopy }: { value: string; onCopy?: () => void }) {
  const half = Math.ceil(value.length / 2), first = value.slice(0, half), second = value.slice(half);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Copy address ${value}`} disabled={!onCopy} onPress={onCopy} style={({ pressed }) => [s.addressWell, { opacity: pressed ? .7 : 1 }]}>
    <Label size={15} style={s.addressLine}><Label size={15} weight="semibold">{first.slice(0, 6)}</Label>{first.slice(6)}</Label>
    <Label size={15} style={s.addressLine}>{second.slice(0, -4)}<Label size={15} weight="semibold">{second.slice(-4)}</Label></Label>
  </Pressable>;
}
export const shared = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  gap: { gap: 12 }, center: { textAlign: 'center' }, flex: { flex: 1 },
  section: { marginTop: 28 }, input: { color: c.ink, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, padding: 18, backgroundColor: c.surface, borderRadius: radius.card, minHeight: 58, borderWidth: 1, borderColor: 'transparent' },
  hero: { backgroundColor: c.brand, borderRadius: radius.hero, padding: 24 },
  orb: { width: 104, height: 104, borderRadius: 52, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
const s = StyleSheet.create({
  flex: { flex: 1 }, screen: { flex: 1, backgroundColor: c.background }, content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 28, paddingBottom: 24, gap: 24 },
  status: { height: 44, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingTop: 24, paddingBottom: 8, minHeight: 96 },
  back: { width: 50, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 56, borderRadius: radius.button, paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' }, center: { textAlign: 'center' },
  card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 20, gap: 14 },
  pill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 10 },
  demoBar: { minHeight: 22, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  tabs: { flexDirection: 'row', backgroundColor: c.surface, minHeight: 72 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10 },
  gestureArea: { height: 20, alignItems: 'center', justifyContent: 'center' }, gesture: { width: 132, height: 4, borderRadius: 2, backgroundColor: c.ink },
  qrTile: { alignSelf: 'center', padding: 8, borderRadius: 20, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
  addressWell: { alignItems: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.background },
  addressLine: { textAlign: 'center', lineHeight: 22, letterSpacing: .4 },
  iconWell: { height: 44, width: 44, borderRadius: radius.button, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: c.surface, borderRadius: radius.card, minHeight: 76 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 3 }, detail: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 28 },
  error: { backgroundColor: c.errorTint, padding: 12, borderRadius: 12 },
  navigation: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 24 },
  menu: { width: 58, height: 58, borderRadius: 29, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  floatingMenu: { position: 'absolute', top: 8, left: 16, zIndex: 10 }, fade: { position: 'absolute', top: 0, left: 0, right: 0, height: 72, zIndex: 5, pointerEvents: 'none' }, floatingShadow: { borderWidth: 1, borderColor: c.line, boxShadow: '0 6px 18px #1F292424', elevation: 6 },
  segment: { flexDirection: 'row', backgroundColor: c.toggle, borderRadius: 29, padding: 5, width: 250, maxWidth: '75%' },
  segmentButton: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  modal: { flex: 1, backgroundColor: '#0000003D' }, drawer: { width: '82%', maxWidth: 358, flex: 1, paddingHorizontal: 28, backgroundColor: c.background, borderTopRightRadius: 28, borderBottomRightRadius: 28 },
  drawerRow: { flexDirection: 'row', alignItems: 'center', gap: 20, minHeight: 52, paddingHorizontal: 8 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
