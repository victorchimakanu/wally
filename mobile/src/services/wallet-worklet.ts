/**
 * Web has no Bare worklet, so there is no keystore here.
 *
 * This is the stub the bundler picks for web (and for anything that is not a native build);
 * `wallet-worklet.native.ts` is the real one. Keeping the split at this boundary means the
 * screens are identical on both and the browser stays usable for checking a layout — the demo
 * wallet needs no keys at all.
 *
 * It refuses rather than pretending. A fake keystore that appeared to create a wallet would be
 * the worst possible thing to ship: somebody would write down a phrase that controls nothing.
 */
import type { Keystore } from './wallet-keystore.ts';

export const keystoreAvailable = false;

export function keystoreUnavailableReason(): string {
  return 'Creating or restoring a wallet needs the Wally app on a phone. The browser preview runs on demo funds.';
}

export async function getKeystore(): Promise<Keystore> {
  throw new Error(keystoreUnavailableReason());
}

export type WalletStatus = { available: false } | { available: true; exists: boolean; backedUpAt: number };

/** Web has no keystore, so there is nothing to report. */
export async function walletStatus(): Promise<WalletStatus> {
  return { available: false };
}
