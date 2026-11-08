import { custodyOf, devServerConfigured, splitPermitted, type Custody } from './custody.ts';
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

/**
 * `custody` travels with `backedUpAt` on purpose. Read alone, that timestamp says "this user
 * wrote their phrase down" and invites the conclusion "so their money is safe" — which is false
 * whenever the money on screen belongs to the dev wallet server rather than to this phone.
 * Carrying custody here means no caller can have one without the other.
 */
export type WalletStatus =
  | { available: false }
  | { available: true; exists: boolean; backedUpAt: number; custody: Custody; protectsDisplayedFunds: boolean };

/** Web has no keystore, so there is nothing to report. */
export async function walletStatus(): Promise<WalletStatus> {
  return { available: false };
}

/**
 * Custody on a platform that cannot hold a wallet.
 *
 * A browser has no keystore, so there is never a device wallet and therefore never a split —
 * the refusal below can only ever trigger on a phone.
 */
export async function currentCustody(): Promise<Custody> {
  return custodyOf({ keystoreWallet: false, devServerConfigured, splitPermitted });
}
