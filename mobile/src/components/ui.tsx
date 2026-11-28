import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { Avatar, Lockup, WallyAsset, type AssetName } from './WallyAsset';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shouldReveal, useShell } from './shell';
import { fonts, makeStyles, radius, useColors } from '../theme';
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
export function Label({ children, size = 14, weight = 'regular', color, style, ...props }: TextProps & { size?: number; weight?: keyof typeof fonts; color?: string }) {
  const c = useColors();
  return <Text {...props} style={[{ fontFamily: fonts[weight], color: color ?? c.ink, fontSize: size, lineHeight: Math.round(size * 1.5) }, style]}>{children}</Text>;
}
export function Button({ label, onPress, secondary = false, accent = false, disabled = false, style }: { label: string; onPress: () => void; secondary?: boolean; accent?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const s = useStyles();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, { backgroundColor: accent ? c.yellow : secondary ? c.surface : c.brand, borderWidth: secondary ? 1 : 0, borderColor: c.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
    <Label size={16} weight="semibold" color={secondary ? c.ink : accent ? c.onAccent : c.onBrand} style={s.center}>{label}</Label>
  </Pressable>;
}
/** An inline action beside a label or a status line: text only, so it never outweighs the screen's main button. */
export function LinkButton({ label, onPress, disabled = false, accessibilityLabel }: { label: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={10}
    style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: disabled ? .4 : pressed ? .6 : 1 })}>
    <Label size={14} weight="semibold" color={c.brand}>{label}</Label>
  </Pressable>;
}
export function Card({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) { const s = useStyles(); return <View style={[s.card, style]}>{children}</View>; }
export function Pill({ children, tone = 'brand' }: React.PropsWithChildren<{ tone?: 'brand' | 'warning' | 'success' }>) {
  const c = useColors();
  const s = useStyles();
  return <View style={[s.pill, { backgroundColor: tone === 'warning' ? c.warningTint : tone === 'success' ? c.successTint : c.tint }]}>
    <Label size={11} weight="medium" color={tone === 'warning' ? c.warning : tone === 'success' ? c.success : c.brand}>{children}</Label>
  </View>;
}
export function Note({ children, error = false }: React.PropsWithChildren<{ error?: boolean }>) {
  const c = useColors();
  const s = useStyles();
  return <Label size={12} color={error ? c.error : c.muted} accessibilityLiveRegion={error ? 'polite' : 'none'} style={error ? s.error : undefined}>{children}</Label>;
}
/** Title bar for pushed screens: a back button and one centred title. A tablet adds the avatar on the right, as its designs do. */
export function Header({ title, back = true }: { title: string; back?: boolean }) {
  const s = useStyles();
  const { tablet, gutter } = useShell();
  return <View style={[s.header, { paddingHorizontal: gutter }]}>
    {back ? <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/wallet')} style={s.back}><View style={{ transform: [{ rotate: '180deg' }] }}><WallyAsset name="afc43.svg" /></View></Pressable> : tablet ? <View style={s.back} /> : null}
    <View style={{ flex: 1, alignItems: 'center' }}><Label weight="semibold" size={16} accessibilityRole="header" numberOfLines={1}>{title}</Label></View>
    {tablet ? <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={s.back}><Avatar size={40} /></Pressable> : back ? <View style={{ width: 50 }} /> : null}
  </View>;
}
/** Testnet or demo, said once in the header instead of on a strip under every screen. */
export function NetworkBadge() {
  const wallet = useWallet();
  return <View accessible accessibilityLabel={wallet.enabled ? 'Testnet: tokens have no monetary value' : 'Demo: fictional funds, no transactions sent'}>
    <Pill tone="warning">{wallet.enabled ? 'Testnet' : 'Demo'}</Pill>
  </View>;
}
/** The desktop page heading: the section's name at the content's left edge, the network badge beside it. */
export function TopBar({ title }: { title: string }) {
  const s = useStyles();
  const { gutter } = useShell();
  return <View style={[s.topBar, { paddingHorizontal: gutter }]}>
    <Label size={25} weight="semibold" accessibilityRole="header" style={{ lineHeight: 31 }}>{title}</Label>
    <NetworkBadge />
  </View>;
}
/**
 * Phone navigation for the two places people live: a menu button and the Wallet/Chat switch,
 * with everything else in the drawer. `floating` keeps only the menu button over an ongoing
 * chat. Wide windows use the sidebar in AppShell instead.
 */
export function AppNavigation({ surface, floating = false }: { surface: 'wallet' | 'chat'; floating?: boolean }) {
  const c = useColors();
  const s = useStyles();
  const shared = useShared();
  const { tablet, gutter } = useShell();
  const [open, setOpen] = useState(false);
  const { state, newChat } = useDemo();
  const { preferences } = usePreferences();
  const insets = useSafeAreaInsets();
  function chat(fresh = false) { const id = fresh ? newChat() : state.chats[0]?.id ?? newChat(); setOpen(false); router.replace({ pathname: '/chat', params: { id } }); }
  function go(path: '/wallet' | '/chats' | '/history' | '/market' | '/settings' | '/profile' | '/address-book') { setOpen(false); router.push(path); }
  const menu = <Pressable accessibilityRole="button" accessibilityLabel="Open app menu" onPress={() => setOpen(true)} style={[s.menu, floating && s.floatingShadow]}><WallyAsset name="f3b34.svg" /></Pressable>;
  return <>
    {floating ? <Animated.View entering={FadeIn.duration(200)} style={s.floatingMenu}>{menu}</Animated.View> : <View style={[s.navigation, { paddingHorizontal: gutter - 8 }]}>
      {menu}
      <View style={s.segment}>{(['wallet', 'chat'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={value === 'wallet' ? 'Wallet' : 'Chat'} accessibilityState={{ selected: surface === value }} onPress={() => value === 'wallet' ? router.replace('/wallet') : chat()} style={[s.segmentButton, surface === value && { backgroundColor: c.raised }]}><Label size={17} weight={surface === value ? 'semibold' : 'regular'}>{value === 'wallet' ? 'Wallet' : 'Chat'}</Label></Pressable>)}</View>
      <NetworkBadge />
      {tablet && <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={s.iconButton}><Avatar size={40} /></Pressable>}
    </View>}
    <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={s.modal}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss app menu" onPress={() => setOpen(false)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[s.drawer, { paddingTop: Math.max(insets.top, 24) + 32, paddingBottom: Math.max(insets.bottom, 20) }]}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
            <View style={shared.between}><Lockup size={120} /><Pressable accessibilityRole="button" accessibilityLabel="Close app menu" onPress={() => setOpen(false)} style={s.iconButton}><WallyAsset name="9e528.svg" /></Pressable></View>
            <Button label="New chat" onPress={() => chat(true)} />
            <View>{([['Wallet', 'bfa3b.svg', '/wallet'], ['Chats', '49ec3.svg', '/chats'], ['Activity', 'b1b14.svg', '/history'], ['Market', '56a25.svg', '/market']] as const).map(([label, icon, path]) => <Pressable key={path} accessibilityRole="button" onPress={() => go(path)} style={s.drawerRow}><WallyAsset name={icon} size={24} /><Label size={16} weight="medium">{label}</Label></Pressable>)}</View>
            {!!state.chats.length && <Label size={12} color={c.muted}>Recent chats</Label>}
            {state.chats.slice(0, 3).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => { setOpen(false); router.push({ pathname: '/chat', params: { id: item.id } }); }} style={{ paddingVertical: 8 }}><Label numberOfLines={1}>{item.title}</Label></Pressable>)}
            <Divider />
            <Pressable accessibilityRole="button" onPress={() => go('/address-book')} style={s.drawerRow}><WallyAsset name="9a2cd.svg" /><Label>Address book</Label></Pressable>
            <Pressable accessibilityRole="button" onPress={() => go('/settings')} style={s.drawerRow}><WallyAsset name="f2470.svg" /><Label>Settings</Label></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => go('/profile')} style={[s.drawerRow, { backgroundColor: c.tint, borderRadius: 22, padding: 16 }]}><Avatar size={44} /><Label weight="semibold">{preferences.name}</Label></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}
/** Messages fade out under the chat's title bar instead of sliding beneath a hard edge. */
// Stepped bands rather than a gradient style, which is still experimental on native.
const FADE_STEPS = [1, .86, .7, .54, .38, .24, .12, .04];
export function Screen({ children, title, tab, surface, immersive = false, footer, back = true, contentStyle, autoScroll = false, fixedHeader, aside, wideContent = false, scrollRequest, onScrollActivity, onNearBottomChange, onViewportHeightChange }: React.PropsWithChildren<{ title?: string; tab?: 'wallet' | 'chats' | 'settings'; surface?: 'wallet' | 'chat'; immersive?: boolean; footer?: React.ReactNode; back?: boolean; contentStyle?: StyleProp<ViewStyle>; autoScroll?: boolean; fixedHeader?: React.ReactNode; /** Desktop only: a 384-wide column to the right of the content. */ aside?: React.ReactNode; /** Desktop only: two-column content, 1104 wide instead of the 696 a list reads best at. */ wideContent?: boolean; scrollRequest?: string | number; onScrollActivity?: () => void; onNearBottomChange?: (near: boolean) => void; onViewportHeightChange?: (height: number) => void }>) {
  const c = useColors();
  const s = useStyles();
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
  // A screen that does NOT follow new content can still ask for something it has just put at
  // the bottom to be brought into view. The Send screen's refusals live there, below a sticky
  // footer: measured in a browser on 23 Nov 2026, a refusal rendered at y=692 in a 626px
  // viewport with 226px of unscrolled content below it. Clicking "Review transfer" appeared to
  // do nothing at all — the explanation was real, rendered, and off-screen.
  useEffect(() => {
    if (!shouldReveal(autoScroll, scrollRequest)) return;
    const frame = requestAnimationFrame(() => toLatest(true));
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest, autoScroll]);
  const insets = useSafeAreaInsets();
  const { state, storageError } = useDemo();
  const { wide, gutter, topLevel } = useShell();
  // Desktop: the sidebar navigates, so main sections get a page heading and chat draws its own.
  // Phone and tablet: Wallet and Chat carry the menu and switch; every other screen is pushed and has Back.
  const header = wide
    ? surface === 'chat' ? null : topLevel || tab === 'wallet' ? <TopBar title={title ?? 'Wallet'} /> : title ? <Header title={title} back={back} /> : null
    : surface || tab === 'wallet' ? <AppNavigation surface={surface ?? 'wallet'} floating={immersive} /> : title ? <Header title={title} back={back} /> : null;
  // Desktop content sits at the page's left edge: 696 wide for a list, 1104 for the two-column
  // screens, with an `aside` taking the right 384 of those 1104, as the desktop designs lay out.
  const showAside = wide && !!aside;
  const column = wide ? (wideContent || showAside ? 1104 : 696) + gutter * 2 : undefined;
  return <View style={[s.screen, column !== undefined && { width: '100%', maxWidth: column, alignSelf: 'flex-start' }, { paddingTop: Platform.OS === 'web' ? 0 : insets.top }]}>
    <View style={[s.flex, { minHeight: 0 }, showAside && { flexDirection: 'row' }]}>
    <KeyboardAvoidingView style={[s.flex, { minHeight: 0 }]} onLayout={event => onViewportHeightChange?.(event.nativeEvent.layout.height)} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      {header}
      {fixedHeader}
      <ScrollView ref={scroll} style={{ flex: 1, minHeight: 0 }} scrollEventThrottle={32} onScroll={event => {
        onScrollActivity?.();
        if (!autoScroll) return;
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const near = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
        // Offsets passed during our own glide are not the user leaving the latest message.
        if (!near && Date.now() - gliding.current < 800) return;
        if (near !== following.current) { following.current = near; onNearBottomChange?.(near); }
      }} onContentSizeChange={() => { if (autoScroll && following.current) toLatest(); }} onLayout={() => { if (autoScroll && following.current) toLatest(false); }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, { paddingHorizontal: gutter }, contentStyle]}>
        {storageError ? <Note error>{storageError}</Note> : null}
        {state.offline && tab && <Pill tone="warning">Offline</Pill>}
        {children}
      </ScrollView>
      {immersive && <View style={[s.fade, { height: wide ? 40 : 72 }]}>{FADE_STEPS.map(opacity => <View key={opacity} style={{ flex: 1, backgroundColor: c.background, opacity }} />)}</View>}
      {footer && <View style={[s.footer, { paddingHorizontal: gutter - 8 }]}>{footer}</View>}
    </KeyboardAvoidingView>
    {showAside && <ScrollView style={{ width: 384 + gutter, flexGrow: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 120, paddingRight: gutter, paddingBottom: 24, gap: 16 }}>{aside}</ScrollView>}
    </View>
    {Platform.OS !== 'web' && <View style={{ height: insets.bottom }} />}
  </View>;
}
/**
 * Rows that belong together, on one surface with hairlines between them, as in iOS Settings.
 * A group carries its own meaning through its rows; `title` is only for when a screen has several.
 */
export function Group({ title, children }: React.PropsWithChildren<{ title?: string }>) {
  const c = useColors();
  const s = useStyles();
  const rows = React.Children.toArray(children);
  if (!rows.length) return null;
  return <View style={{ gap: 8 }}>
    {title && <Label size={13} weight="medium" color={c.muted} accessibilityRole="header" style={{ paddingHorizontal: 16 }}>{title}</Label>}
    <View style={s.group}>{rows.map((row, index) => <React.Fragment key={index}>{index > 0 && <View style={s.separator} />}{row}</React.Fragment>)}</View>
  </View>;
}
/**
 * One line of a list: what it is, and its current value on the right. No second line: a row
 * that needs explaining is the wrong row. A chevron means it opens something; `danger` is for
 * the one row on a screen that removes something.
 */
export function Row({ icon, title, value, onPress, danger = false, selected }: { icon?: AssetName; title: string; value?: string; onPress?: () => void; danger?: boolean; selected?: boolean }) {
  const c = useColors();
  const s = useStyles();
  const content = <>
    {icon && <WallyAsset name={icon} size={22} />}
    <Label size={16} color={danger ? c.error : c.ink} numberOfLines={value ? 1 : 2} style={s.flex}>{title}</Label>
    {!!value && <Label size={15} color={c.muted} numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Label>}
    {selected && <Icon name="check" />}
    {onPress && selected === undefined && <View style={{ opacity: .35 }}><WallyAsset name="afc43.svg" size={14} /></View>}
  </>;
  const label = value ? `${title}, ${value}` : title;
  return onPress
    ? <Pressable accessibilityRole={selected === undefined ? 'button' : 'radio'} accessibilityState={selected === undefined ? undefined : { checked: selected }} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: c.toggle }]}>{content}</Pressable>
    : <View accessible accessibilityLabel={label} style={s.row}>{content}</View>;
}
export function Detail({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  const c = useColors();
  const s = useStyles();
  return <View style={s.detail}><Label size={emphasis ? 14 : 12} color={emphasis ? c.ink : c.muted} style={{ flex: 1 }}>{label}</Label><Label size={emphasis ? 16 : 13} weight={emphasis ? 'semibold' : 'medium'} style={{ flexShrink: 1, textAlign: 'right' }}>{value}</Label></View>;
}
export function Divider() { const s = useStyles(); return <View style={s.divider} />; }
export function Address({ value }: { value: string }) { return <Label selectable weight="medium" style={{ overflowWrap: 'anywhere' } as TextStyle}>{value}</Label>; }
/** Frames a receive QR code in a bordered tile so it reads as one scannable object. */
export function QrTile({ children }: React.PropsWithChildren) { const s = useStyles(); return <View style={s.qrTile}>{children}</View>; }
/** A receive address in two balanced lines, first and last characters emphasised for checking. Tapping copies the exact address. */
export function ReceiveAddress({ value, onCopy }: { value: string; onCopy?: () => void }) {
  const s = useStyles();
  const half = Math.ceil(value.length / 2), first = value.slice(0, half), second = value.slice(half);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Copy address ${value}`} disabled={!onCopy} onPress={onCopy} style={({ pressed }) => [s.addressWell, { opacity: pressed ? .7 : 1 }]}>
    <Label size={15} style={s.addressLine}><Label size={15} weight="semibold">{first.slice(0, 6)}</Label>{first.slice(6)}</Label>
    <Label size={15} style={s.addressLine}>{second.slice(0, -4)}<Label size={15} weight="semibold">{second.slice(-4)}</Label></Label>
  </Pressable>;
}
/** Layout helpers every screen uses; a hook because `input` and `orb` carry colour. */
export const useShared = makeStyles(c => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  gap: { gap: 12 }, center: { textAlign: 'center' }, flex: { flex: 1 },
  section: { marginTop: 28 }, input: { color: c.ink, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, padding: 18, backgroundColor: c.surface, borderRadius: radius.card, minHeight: 58, borderWidth: 1, borderColor: 'transparent' },
  orb: { width: 104, height: 104, borderRadius: 52, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
}));
const useStyles = makeStyles(c => ({
  flex: { flex: 1 }, screen: { flex: 1, backgroundColor: c.background }, content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 16, paddingBottom: 24, gap: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 30 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingTop: 12, paddingBottom: 4, minHeight: 64 },
  back: { width: 50, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  button: { minHeight: 56, borderRadius: radius.button, paddingHorizontal: 20, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' }, center: { textAlign: 'center' },
  card: { backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, padding: 20, gap: 14 },
  pill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 10 },
  qrTile: { alignSelf: 'center', padding: 8, borderRadius: 20, borderWidth: 1, borderColor: c.line, backgroundColor: c.paper },
  addressWell: { alignItems: 'center', gap: 2, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.background },
  addressLine: { textAlign: 'center', lineHeight: 22, letterSpacing: .4 },
  group: { backgroundColor: c.surface, borderRadius: radius.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.line, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, paddingHorizontal: 16, paddingVertical: 12 },
  divider: { height: 1, backgroundColor: c.line, marginVertical: 3 }, detail: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 28 },
  error: { backgroundColor: c.errorTint, padding: 12, borderRadius: 12 },
  fade: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, pointerEvents: 'none' },
  navigation: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  menu: { width: 58, height: 58, borderRadius: 29, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  floatingMenu: { position: 'absolute', top: 8, left: 16, zIndex: 10 }, floatingShadow: { borderWidth: 1, borderColor: c.line, boxShadow: `0 6px 18px ${c.shadow}`, elevation: 6 },
  segment: { flex: 1, maxWidth: 250, flexDirection: 'row', backgroundColor: c.toggle, borderRadius: 29, padding: 5 },
  segmentButton: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  modal: { flex: 1, backgroundColor: c.overlay }, drawer: { width: '82%', maxWidth: 358, flex: 1, paddingHorizontal: 28, backgroundColor: c.background, borderTopRightRadius: 28, borderBottomRightRadius: 28 },
  drawerRow: { flexDirection: 'row', alignItems: 'center', gap: 20, minHeight: 52, paddingHorizontal: 8 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
}));
