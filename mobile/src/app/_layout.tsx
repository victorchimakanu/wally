import React from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ActivityIndicator, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DemoProvider, useDemo } from '../demo/store';
import { PreferencesProvider } from '../demo/preferences';
import { MarketProvider } from '../data/market';
import { WallyAsset } from '../components/WallyAsset';
import { WalletProvider, useWallet } from '../data/wallet';
import { Label } from '../components/ui';
import { colors as c } from '../theme';

function AppContent() {
  const wallet = useWallet();
  const { ready, ai } = useDemo();
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const desktop = Platform.OS === 'web' && width >= 900;
  const chatLayout = pathname === '/chat';
  if (!ready) return <View style={styles.loading}><ActivityIndicator color={c.brand} /><Label color={c.muted}>Opening your wallet…</Label></View>;
  const app = <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'slide_from_right' }} />;
  return <View style={!desktop || chatLayout ? styles.native : styles.stage}>
    {desktop && !chatLayout && <View key="intro" style={styles.intro}><WallyAsset name="wally-lockup-light.svg" size={124} style={{ alignSelf: 'flex-start' }} /><Label size={44} weight="semibold" style={{ lineHeight: 56, marginTop: 34 }}>Your money.{'\n'}Just ask Wally.</Label><Label size={16} color={c.muted} style={{ marginTop: 24, lineHeight: 26 }}>The Android frontend, ready to explore. A little less friction. A lot more control.</Label><View style={styles.rule} /><Label size={11} weight="medium" color={c.brand}>INTERACTIVE MOBILE PREVIEW</Label><Label size={12} color={c.muted} style={{ marginTop: 12 }}>Try a transfer, start a conversation, or explore Settings to test offline and expired states.</Label><Label size={11} color={c.muted} style={{ marginTop: 28 }}>{wallet.enabled ? 'Testnet balances. ' : 'Fictional balances. '}{ai.mode === 'qvac' ? (ai.location === 'phone' ? 'QVAC inside this phone.' : 'QVAC on your computer.') : 'Scripted replies.'}{'\n'}Built with React Native + Expo.</Label></View>}
    <View key="app" style={desktop && !chatLayout ? [styles.phone, { height: Math.min(844, height - 48) }] : styles.native}>{app}</View>
  </View>;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  });
  if (error) return <View style={styles.loading}><Text>Wally could not load its bundled fonts. Reload the preview to try again.</Text></View>;
  if (!loaded) return <View style={styles.loading}><ActivityIndicator color={c.brand} /></View>;
  return <SafeAreaProvider><StatusBar style="dark" /><WalletProvider><DemoProvider><PreferencesProvider><MarketProvider><AppContent /></MarketProvider></PreferencesProvider></DemoProvider></WalletProvider></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  native: { flex: 1 }, loading: { flex: 1, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  stage: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 100, backgroundColor: '#EAF0FC', padding: 24 },
  intro: { width: 330 }, rule: { height: 1, backgroundColor: '#D5DFF4', marginVertical: 32 },
  phone: { width: 390, backgroundColor: c.background, borderRadius: 28, overflow: 'hidden', boxShadow: '0 24px 90px rgba(30,31,75,0.12)' },
});

