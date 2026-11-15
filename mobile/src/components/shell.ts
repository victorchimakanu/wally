import { createContext, useContext } from 'react';

/** Tablets in landscape and desktop windows get the sidebar; phones get the menu drawer. */
export const WIDE_LAYOUT = 900;
/** `topLevel`: one of the five sections the sidebar lists. */
export type Shell = { wide: boolean; topLevel: boolean };
export const ShellContext = createContext<Shell>({ wide: false, topLevel: false });
export const useShell = () => useContext(ShellContext);
