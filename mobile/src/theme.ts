import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';

/** WallyUI active mobile flows, Figma 733:10038 and 733:10272. */
export const light = {
  brand: '#17201C', onBrand: '#FFFFFF', ink: '#17201C', background: '#FBFCFD', surface: '#FFFFFF',
  tint: '#F3EEFF', muted: '#68726D', line: '#E8ECEA',
  lilac: '#CBBBF1', yellow: '#F6D469', onAccent: '#17201C', orange: '#F2A03D', amber: '#FFF4E3', toggle: '#ECEEED',
  success: '#21856B', successTint: '#E7F5EF', warning: '#956111', warningTint: '#FFF3DA',
  error: '#B34747', errorTint: '#FCECEC',
  overlay: '#0000003D', shadow: '#1F292414',
  /** A selected segment or a floating button: lighter than the track it sits on in both modes. */
  raised: '#FFFFFF', knobOn: '#FFFFFF', knobOff: '#FFFFFF',
  /** Stays white in both modes; a QR code must be dark on light to scan. */
  paper: '#FFFFFF',
};
export type Palette = typeof light;
/**
 * The same roles on a near-black green. `brand` flips to light so primary buttons and links
 * still lead; `onAccent` stays dark because the yellow button and the demo balance card do.
 */
export const dark: Palette = {
  brand: '#F1F4F2', onBrand: '#0F1412', ink: '#F1F4F2', background: '#0F1412', surface: '#181E1B',
  tint: '#2A2640', muted: '#9AA39E', line: '#2A322E',
  lilac: '#CBBBF1', yellow: '#F6D469', onAccent: '#17201C', orange: '#F2A03D', amber: '#36301F', toggle: '#232A27',
  success: '#5FCDA6', successTint: '#16302A', warning: '#E8B058', warningTint: '#342B18',
  error: '#EF7D7D', errorTint: '#3A2323',
  overlay: '#00000099', shadow: '#00000066',
  raised: '#2C3531', knobOn: '#0F1412', knobOff: '#F1F4F2',
  paper: '#FFFFFF',
};
export const palettes = { light, dark };
export const fonts = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' };
export const radius = { card: 24, button: 29 };

export type Theme = { palette: Palette; dark: boolean };
/** Provided by `ThemeProvider`; the light palette stands in above it, such as on the crash screen. */
export const ThemeContext = createContext<Theme>({ palette: light, dark: false });
export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).palette;

/**
 * A stylesheet per palette, built once and reused, so a component writes `const s = useStyles()`
 * where it used to read a module constant. Geometry-only sheets can stay as `StyleSheet.create`.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const c = useColors();
    let styles = cache.get(c);
    if (!styles) { styles = StyleSheet.create(factory(c)); cache.set(c, styles); }
    return styles;
  };
}
