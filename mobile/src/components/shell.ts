import { createContext, useContext } from 'react';

/**
 * The layout tiers from the WallyUI designs (Tablet · Home, Desktop · Home and the responsive
 * checks). A phone keeps the menu button and the Wallet/Chat switch; a tablet held upright keeps
 * that bar with wider gutters and the avatar on its right; a tablet on its side adds the icon
 * rail; a desktop window gets the full sidebar, page headings and two-column content.
 */
export type Layout = 'phone' | 'tablet' | 'rail' | 'desktop';
export function layoutFor(width: number): Layout {
  return width >= 1200 ? 'desktop' : width >= 960 ? 'rail' : width >= 700 ? 'tablet' : 'phone';
}
/** The content inset each tier draws: 40 on a tablet, 32 beside the rail, 40 or 48 on desktop. */
export function gutterFor(layout: Layout, width: number): number {
  return layout === 'desktop' ? (width >= 1400 ? 48 : 40) : layout === 'rail' ? 32 : layout === 'tablet' ? 40 : 28;
}
/** `topLevel`: one of the sections the sidebar and rail list. */
export type Shell = { layout: Layout; gutter: number; topLevel: boolean };
export const ShellContext = createContext<Shell>({ layout: 'phone', gutter: 28, topLevel: false });
/** `wide` is the desktop tier; `tablet` covers both tablet tiers, which share the phone's bar. */
export function useShell() {
  const shell = useContext(ShellContext);
  return { ...shell, wide: shell.layout === 'desktop', tablet: shell.layout === 'tablet' || shell.layout === 'rail' };
}

/**
 * Whether a `scrollRequest` should bring the bottom of the screen into view.
 *
 * Two different jobs share one prop. A chat **follows** new content, so it scrolls on every
 * request including the first empty one. Every other screen follows nothing, and asks only to
 * **reveal** something it has just rendered — so an absent or empty request means "nothing to
 * show", and scrolling on mount would yank a screen the user has not touched.
 *
 * Extracted because the effect that uses it cannot run without a ScrollView, and a rule that
 * can only be tested by rendering is a rule nobody tests.
 */
export function shouldReveal(autoScroll: boolean, request: string | number | undefined): boolean {
  return !autoScroll && !!request;
}
