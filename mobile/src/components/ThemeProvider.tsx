import React, { useEffect } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemeContext, palettes } from '../theme';
import { usePreferences } from '../demo/preferences';

/** The system's scheme alone, for the crash screen and anything else that renders before preferences exist. */
export function SystemTheme({ children }: React.PropsWithChildren) {
  const dark = useColorScheme() === 'dark';
  return <ThemeContext value={{ palette: palettes[dark ? 'dark' : 'light'], dark }}>{children}</ThemeContext>;
}

/** Follows the system unless Settings says otherwise; one place for the palette and the status bar. */
export function ThemeProvider({ children }: React.PropsWithChildren) {
  const system = useColorScheme();
  const { preferences } = usePreferences();
  const appearance = preferences.appearance ?? 'system';
  const dark = appearance === 'dark' || (appearance === 'system' && system === 'dark');
  const palette = palettes[dark ? 'dark' : 'light'];
  // The browser paints outside the app's root too: overscroll, scrollbars and form controls.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.style.backgroundColor = palette.background;
  }, [dark, palette]);
  return <ThemeContext value={{ palette, dark }}><StatusBar style={dark ? 'light' : 'dark'} />{children}</ThemeContext>;
}
