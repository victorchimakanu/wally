import React from 'react';
import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, useWindowDimensions, View, type PressableStateCallbackType, type ViewStyle } from 'react-native';
import { Avatar, Lockup, WallyAsset } from './WallyAsset';
import { Label } from './ui';
import { ShellContext, gutterFor, layoutFor } from './shell';
import type { AssetName } from './WallyAsset';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { type Palette, makeStyles, useColors } from '../theme';

type Section = { path: '/wallet' | '/chat' | '/chats' | '/market' | '/history' | '/address-book'; label: string; icon: AssetName };
/** The order the sidebar and rail list them in, from the WallyUI shared navigation. */
const SECTIONS: Section[] = [
  { path: '/wallet', label: 'Wallet', icon: 'bfa3b.svg' },
  { path: '/chat', label: 'Chat', icon: '49ec3.svg' },
  { path: '/market', label: 'Market', icon: '56a25.svg' },
  { path: '/history', label: 'Activity', icon: 'b1b14.svg' },
  { path: '/address-book', label: 'Address book', icon: '9a2cd.svg' },
];
// Settings has no section of its own: everything you set lives on the Profile screen, which the
// avatar opens from the bar, the rail, the sidebar and the drawer.
/**
 * Beside the rail the Wallet/Chat switch is still on screen, and it alone moves between the
 * wallet and a conversation. So the rail's section is Chats, the list, like the drawer's row;
 * only the desktop sidebar, which has no switch, opens a conversation directly.
 */
const RAIL_SECTIONS: Section[] = SECTIONS.map(section => section.path === '/chat' ? { path: '/chats', label: 'Chats', icon: section.icon } : section);
/** Screens reached from a section keep that section highlighted. */
const OWNER: Record<string, Section['path']> = {
  '/send': '/wallet', '/receive': '/wallet', '/review': '/wallet', '/scan': '/wallet',
  '/chats': '/chat', '/clear-chats': '/chat',
  '/transaction': '/history', '/export-data': '/history',
  '/asset': '/market',
};
const RAIL_OWNER: Record<string, Section['path']> = { ...OWNER, '/chat': '/chats', '/clear-chats': '/chats' };
/** Onboarding stands on its own, without app navigation. */
const ONBOARDING = ['/', '/wallet-setup', '/restore-wallet'];

function useOpenSection() {
  const { state, newChat } = useDemo();
  return (path: Section['path']) => {
    if (path === '/chat') { router.replace({ pathname: '/chat', params: { id: state.chats[0]?.id ?? newChat() } }); return; }
    router.replace(path);
  };
}

/** Hover is web-only and missing from React Native's types; pressed covers touch. */
const rowStyle = (c: Palette, base: ViewStyle, selected = false) => (state: PressableStateCallbackType) => [base, selected ? { backgroundColor: c.tint } : (state as PressableStateCallbackType & { hovered?: boolean }).hovered || state.pressed ? { backgroundColor: c.toggle } : null];

type NavigationProps = { active: Section['path'] | undefined; pathname: string };

/**
 * Desktop: the lockup, New chat, the sections, a quiet list of recent chats with a way to see
 * them all, and the account at the foot. Rows are compact (40 px, 15 px labels, 20 px icons),
 * as a sidebar beside a reading column should be; the mark stays the ring lockup.
 */
function Sidebar({ active, pathname, width }: NavigationProps & { width: number }) {
  const c = useColors();
  const s = useStyles();
  const { state, newChat } = useDemo();
  const { preferences } = usePreferences();
  const open = useOpenSection();
  return <View style={[s.sidebar, { width: width >= 1400 ? 240 : 224 }]}>
    <Lockup size={104} style={{ marginLeft: 6, marginBottom: 12 }} />
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Start a new chat" onPress={() => router.replace({ pathname: '/chat', params: { id: newChat() } })} style={rowStyle(c, s.sideRow)}>
        <WallyAsset name="b64e9.svg" size={20} /><Label size={15}>New chat</Label>
      </Pressable>
      <View accessibilityRole="tablist" style={{ gap: 2, marginTop: 10 }}>
        {SECTIONS.map(section => {
          const selected = active === section.path;
          return <Pressable key={section.path} accessibilityRole="tab" accessibilityLabel={section.label} accessibilityState={{ selected }} onPress={() => { if (pathname !== section.path) open(section.path); }} style={rowStyle(c, s.sideRow, selected)}>
            <WallyAsset name={section.icon} size={20} /><Label size={15} weight={selected ? 'medium' : 'regular'}>{section.label}</Label>
          </Pressable>;
        })}
      </View>
      {!!state.chats.length && <View style={{ gap: 2, marginTop: 18 }}>
        <Label size={12} weight="medium" color={c.muted} style={{ paddingHorizontal: 10, marginBottom: 4 }}>Recent chats</Label>
        {state.chats.slice(0, 8).map(chat => <Pressable key={chat.id} accessibilityRole="button" accessibilityLabel={`Open chat ${chat.title}`} onPress={() => router.replace({ pathname: '/chat', params: { id: chat.id } })} style={rowStyle(c, s.chatRow)}>
          <Label size={14} numberOfLines={1}>{chat.title}</Label>
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="See all chats" onPress={() => router.push('/chats')} style={rowStyle(c, s.chatRow)}>
          <Label size={14} color={c.muted}>See all</Label>
        </Pressable>
      </View>}
    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={rowStyle(c, s.profile)}>
      <Avatar size={28} /><Label size={14} weight="medium" numberOfLines={1} style={{ flex: 1 }}>{preferences.name}</Label>
    </Pressable>
  </View>;
}

/** Tablet on its side: the same sections as icons only, the profile at the foot. */
function Rail({ active, pathname }: NavigationProps) {
  const c = useColors();
  const s = useStyles();
  const open = useOpenSection();
  return <View style={s.rail}>
    <View accessibilityRole="tablist" style={{ gap: 24, alignItems: 'center' }}>
      {RAIL_SECTIONS.map(section => {
        const selected = active === section.path;
        return <Pressable key={section.path} accessibilityRole="tab" accessibilityLabel={section.label} accessibilityState={{ selected }} onPress={() => { if (pathname !== section.path) open(section.path); }} style={rowStyle(c, s.railItem, selected)}>
          <WallyAsset name={section.icon} size={24} />
        </Pressable>;
      })}
    </View>
    <View style={{ flex: 1 }} />
    <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')}><Avatar size={40} /></Pressable>
  </View>;
}

/**
 * The app's frame. A desktop window gets the sidebar, a tablet on its side the rail; phones and
 * upright tablets navigate from the Wallet/Chat bar's menu, which the screens draw themselves.
 */
export function AppShell({ children }: React.PropsWithChildren) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const layout = layoutFor(width);
  const onboarding = ONBOARDING.includes(pathname);
  const sections = layout === 'rail' ? RAIL_SECTIONS : SECTIONS;
  const topLevel = sections.some(section => section.path === pathname);
  const active = sections.find(section => section.path === pathname)?.path ?? (layout === 'rail' ? RAIL_OWNER : OWNER)[pathname];
  const navigation = onboarding ? null : layout === 'desktop' ? <Sidebar active={active} pathname={pathname} width={width} /> : layout === 'rail' ? <Rail active={active} pathname={pathname} /> : null;
  return <ShellContext value={{ layout, gutter: gutterFor(layout, width), topLevel }}>
    <View style={[s.frame, !!navigation && { flexDirection: 'row' }]}>
      {navigation}
      <View style={s.main}>{children}</View>
    </View>
  </ShellContext>;
}

const useStyles = makeStyles(c => ({
  frame: { flex: 1, backgroundColor: c.background }, main: { flex: 1, minWidth: 0, minHeight: 0 },
  sidebar: { borderRightWidth: 1, borderColor: c.line, backgroundColor: c.surface, paddingHorizontal: 12, paddingTop: 20, paddingBottom: 12, gap: 8 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 40, paddingHorizontal: 10, borderRadius: 12 },
  chatRow: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: 12 },
  rail: { width: 88, borderRightWidth: 1, borderColor: c.line, backgroundColor: c.surface, paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center' },
  railItem: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
}));
