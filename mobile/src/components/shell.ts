import { createContext, useContext } from 'react';

/** Tablets in landscape and desktop windows get the sidebar; phones get the tab bar. */
export const WIDE_LAYOUT = 900;
/** `topLevel`: one of the five main sections. `tabBar`: the phone tab bar is showing below the screen. */
export type Shell = { wide: boolean; topLevel: boolean; tabBar: boolean };
export const ShellContext = createContext<Shell>({ wide: false, topLevel: false, tabBar: false });
export const useShell = () => useContext(ShellContext);
