import React, { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { routeForLink } from '../services/deep-link';
import { CrashBoundary } from '../components/CrashBoundary';
import { installCrashHandlers } from '../services/crash-log-device';
import { buildInfo, supportSummary } from '../services/build-info';
import { DemoProvider, useDemo } from '../demo/store';
import { PreferencesProvider } from '../demo/preferences';
import { MarketProvider } from '../data/market';
import { AppShell } from '../components/AppShell';
import { WalletProvider } from '../data/wallet';
import { Label } from '../components/ui';
import { colors as c } from '../theme';

function AppContent() {
  const { ready } = useDemo();
  if (!ready) return <View style={styles.loading}><ActivityIndicator color={c.brand} /><Label color={c.muted}>Opening your wallet…</Label></View>;
  return <AppShell><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background }, animation: 'slide_from_right' }} /></AppShell>;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
    Inter_500Medium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
    Inter_700Bold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  });
  // Incoming links: the one Wally was opened with, and any that arrive while it is running.
  // Routed through `routeForLink`, which holds a link to the same refusals as a scanned code,
  // because both are untrusted descriptions of a payment arriving from somewhere else.
  useEffect(() => {
    let live = true;
    const open = (url: string | null) => {
      if (!live || !url) return;
      const route = routeForLink(url);
      // A link that is not for us is not an error, and a refused one is not worth a screen of
      // its own: the app simply opens where it was going to.
      if (route.ok) router.push({ pathname: route.pathname as never, params: route.params });
    };
    void Linking.getInitialURL().then(open).catch(() => {});
    const subscription = Linking.addEventListener('url', event => open(event.url));
    return () => { live = false; subscription.remove(); };
  }, []);

  // Installed once, at the root, before anything else can fail. Returns a teardown so a fast
  // refresh in development does not stack handlers.
  useEffect(() => installCrashHandlers(supportSummary(buildInfo({
    appVersion: Constants.expoConfig?.version, os: Platform.OS, isDevelopment: __DEV__,
  }))), []);

  if (error) return <View style={styles.loading}><Text>Wally could not load its bundled fonts. Reload the preview to try again.</Text></View>;
  if (!loaded) return <View style={styles.loading}><ActivityIndicator color={c.brand} /></View>;
  // The boundary is outermost on purpose: a provider that throws while mounting would
  // otherwise take the whole tree with it and leave a white screen, which on a wallet is
  // indistinguishable from a transfer that went through.
  return <CrashBoundary><SafeAreaProvider><StatusBar style="dark" /><WalletProvider><DemoProvider><PreferencesProvider><MarketProvider><AppContent /></MarketProvider></PreferencesProvider></DemoProvider></WalletProvider></SafeAreaProvider></CrashBoundary>;
}
const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
});

