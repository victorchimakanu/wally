import React from 'react';
import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type PressableStateCallbackType, type ViewStyle } from 'react-native';
import { Avatar, WallyAsset } from './WallyAsset';
import { Button, Label, NetworkBadge } from './ui';
import { ShellContext, WIDE_LAYOUT } from './shell';
import type { AssetName } from './WallyAsset';
import { useDemo } from '../demo/store';
import { usePreferences } from '../demo/preferences';
import { colors as c } from '../theme';

type Section = { path: '/wallet' | '/chat' | '/history' | '/market' | '/settings'; label: string; icon: AssetName };
const SECTIONS: Section[] = [
  { path: '/wallet', label: 'Wallet', icon: 'bfa3b.svg' },
  { path: '/chat', label: 'Chat', icon: '49ec3.svg' },
  { path: '/history', label: 'Activity', icon: 'b1b14.svg' },
  { path: '/market', label: 'Market', icon: '56a25.svg' },
  { path: '/settings', label: 'Settings', icon: 'f2470.svg' },
];
/** Screens reached from a section keep that section highlighted. */
const OWNER: Record<string, Section['path']> = {
  '/send': '/wallet', '/receive': '/wallet', '/review': '/wallet', '/scan': '/wallet', '/notifications': '/wallet',
  '/chats': '/chat', '/clear-chats': '/chat',
  '/transaction': '/history', '/export-data': '/history',
  '/asset': '/market',
  '/preferences': '/settings', '/profile': '/settings', '/address-book': '/settings', '/licences': '/settings', '/problems': '/settings',
  '/recovery-phrase': '/settings', '/reset-wallet': '/settings', '/phone-performance': '/settings',
};
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
const rowStyle = (base: ViewStyle, selected = false) => (state: PressableStateCallbackType) => [base, selected ? { backgroundColor: c.tint } : (state as PressableStateCallbackType & { hovered?: boolean }).hovered || state.pressed ? { backgroundColor: c.toggle } : null];

function Sidebar({ active, pathname }: { active: Section['path'] | undefined; pathname: string }) {
  const { state, newChat } = useDemo();
  const { preferences } = usePreferences();
  const open = useOpenSection();
  return <View style={s.sidebar}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 16 }}>
      <View style={[s.between, { paddingHorizontal: 8, paddingTop: 8 }]}><WallyAsset name="wally-lockup-light.svg" size={112} /><NetworkBadge /></View>
      <Button label="New chat" onPress={() => router.replace({ pathname: '/chat', params: { id: newChat() } })} />
      <View accessibilityRole="tablist" style={{ gap: 2 }}>
        {SECTIONS.map(section => {
          const selected = active === section.path;
          return <Pressable key={section.path} accessibilityRole="tab" accessibilityLabel={section.label} accessibilityState={{ selected }} onPress={() => { if (pathname !== section.path) open(section.path); }} style={rowStyle(s.sideRow, selected)}>
            <WallyAsset name={section.icon} size={22} /><Label size={15} weight={selected ? 'semibold' : 'medium'}>{section.label}</Label>
          </Pressable>;
        })}
      </View>
      {!!state.chats.length && <View style={{ gap: 2 }}>
        <Label size={12} weight="medium" color={c.muted} style={{ paddingHorizontal: 12, marginBottom: 4 }}>Recent chats</Label>
        {state.chats.slice(0, 6).map(chat => <Pressable key={chat.id} accessibilityRole="button" accessibilityLabel={`Open chat ${chat.title}`} onPress={() => router.replace({ pathname: '/chat', params: { id: chat.id } })} style={rowStyle(s.chatRow)}>
          <Label size={14} numberOfLines={1}>{chat.title}</Label>
        </Pressable>)}
      </View>}
    </ScrollView>
    <Pressable accessibilityRole="button" accessibilityLabel="View profile" onPress={() => router.push('/profile')} style={s.profile}>
      <Avatar size={36} /><Label weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{preferences.name}</Label>
    </Pressable>
  </View>;
}

/** The app's frame: a sidebar on wide windows. Phones navigate from the Wallet/Chat bar's drawer. */
export function AppShell({ children }: React.PropsWithChildren) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const wide = width >= WIDE_LAYOUT;
  const onboarding = ONBOARDING.includes(pathname);
  const topLevel = SECTIONS.some(section => section.path === pathname);
  const active = SECTIONS.find(section => section.path === pathname)?.path ?? OWNER[pathname];
  return <ShellContext value={{ wide, topLevel }}>
    <View style={[s.frame, wide && { flexDirection: 'row' }]}>
      {wide && !onboarding && <Sidebar active={active} pathname={pathname} />}
      <View style={s.main}>{children}</View>
    </View>
  </ShellContext>;
}

const s = StyleSheet.create({
  frame: { flex: 1, backgroundColor: c.background }, main: { flex: 1, minWidth: 0, minHeight: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sidebar: { width: 272, borderRightWidth: 1, borderColor: c.line, backgroundColor: c.surface, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44, paddingHorizontal: 12, borderRadius: 14 },
  chatRow: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: c.background },
});
