import { createContext, useContext } from 'react';

/** Tablets in landscape and desktop windows get the sidebar; phones get the menu drawer. */
export const WIDE_LAYOUT = 900;
/** `topLevel`: one of the five sections the sidebar lists. */
export type Shell = { wide: boolean; topLevel: boolean };
export const ShellContext = createContext<Shell>({ wide: false, topLevel: false });
export const useShell = () => useContext(ShellContext);

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
