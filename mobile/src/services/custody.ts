/**
 * Which wallet this app is actually using, and whether the phrase it can show you controls it.
 *
 * There are two wallets in Wally and they are not the same wallet. The recovery flow creates
 * one whose seed is chosen inside the WDK worklet and encrypted into the OS keystore. Balances,
 * addresses and sending come from the loopback dev wallet server, which holds *its own seed on
 * a developer's computer*.
 *
 * Today that is survivable only because the worklet cannot run. The moment it can, an app in
 * both states at once shows you one wallet's money while offering to back up a different
 * wallet's phrase — so a user who writes down their twelve words has not backed up the funds on
 * their screen, and a user who funds the address on Receive has funded a wallet those words
 * cannot recover. That is the worst outcome this app can produce, and nothing in the code
 * currently notices it.
 *
 * `spendAllowed()` is the sharpest edge. It is written, correct and wired to nothing. Connected
 * to the send flow as things stand, it would read the *keystore* wallet's backup flag to permit
 * spending the *dev server's* money: the user confirms twelve words, sending unlocks, and the
 * words protect something else. That is one line away, and it is an open assignment.
 *
 * **The decision, 8 November 2026: refuse the split rather than label it.** If a wallet exists
 * on this device, that is the wallet. A build that cannot open it says so and shows nothing,
 * rather than quietly displaying another wallet's balances and address. An honest failure beats
 * a confident wrong number — the same rule the balance code already follows, where a missing
 * balance reads "Unavailable" and never zero.
 *
 * Development keeps an escape hatch, because a dev build whose worklet cannot start would
 * otherwise go dark: `EXPO_PUBLIC_WALLY_ALLOW_SPLIT_WALLET=1` permits the split and every
 * money-facing screen then carries `custodyNotice()`. It is opt-in, and it is loud.
 *
 * This module is pure so the rule can be tested without a device, a worklet or a server.
 */

export type Custody =
  /** No wallet of any kind. The app is on demo funds, and everything is labelled fictional. */
  | { kind: 'none' }
  /** A wallet on this device and nothing else. The phrase controls the money. The goal. */
  | { kind: 'device' }
  /** The dev wallet server and no device wallet. A developer's scaffold; no phrase exists. */
  | { kind: 'dev-server' }
  /** Both. `permitted` only when a developer opted in explicitly. */
  | { kind: 'split'; permitted: boolean };

export type CustodyInput = {
  /** A record exists in the vault. Read from the OS keystore; does not start the worklet. */
  keystoreWallet: boolean;
  /** `EXPO_PUBLIC_WALLY_API_URL` is set, so the loopback dev wallet server is configured. */
  devServerConfigured: boolean;
  /** `EXPO_PUBLIC_WALLY_ALLOW_SPLIT_WALLET` — development only. */
  splitPermitted?: boolean;
};

export function custodyOf({ keystoreWallet, devServerConfigured, splitPermitted = false }: CustodyInput): Custody {
  if (keystoreWallet && devServerConfigured) return { kind: 'split', permitted: splitPermitted };
  if (keystoreWallet) return { kind: 'device' };
  if (devServerConfigured) return { kind: 'dev-server' };
  return { kind: 'none' };
}

/**
 * Where the money on screen comes from, or `blocked`.
 *
 * `blocked` is the refusal: a wallet exists on this device, something else is configured to
 * provide the money, and nobody opted into that. Screens must show nothing rather than choose.
 */
export type MoneySource = 'demo' | 'device' | 'dev-server' | 'blocked';

export function moneySource(custody: Custody): MoneySource {
  switch (custody.kind) {
    case 'none': return 'demo';
    case 'device': return 'device';
    case 'dev-server': return 'dev-server';
    case 'split': return custody.permitted ? 'dev-server' : 'blocked';
  }
}

/**
 * Does the recovery phrase this app can show control the funds this app is displaying?
 *
 * False in `split` **even when permitted** — permission changes what is shown, never what is
 * true. False in `dev-server`, where no phrase exists in the app at all. False in `none`, where
 * the funds are fictional and there is nothing to protect.
 */
export function protectsDisplayedFunds(custody: Custody): boolean {
  return custody.kind === 'device';
}

/**
 * What a person needs told, or null when nothing is wrong.
 *
 * One string, used by every money-facing screen, so the warning cannot drift from the state it
 * describes the way a hardcoded label does.
 */
export function custodyNotice(custody: Custody): string | null {
  switch (custody.kind) {
    case 'none':
    case 'device':
      return null;
    case 'dev-server':
      return 'These are testnet funds held by the wallet server on your computer, not by this phone. There is no recovery phrase for them here — back up that server’s seed file yourself.';
    case 'split':
      return custody.permitted
        ? 'Two wallets are active. The balances and the receive address below belong to the wallet server on your computer. Your recovery phrase belongs to a different wallet, and writing it down does not protect this money. Do not send real funds to this address.'
        : 'This build cannot open the wallet stored on this phone, and it will not show you a different wallet’s money instead.';
  }
}

export type SpendDecision =
  | { allowed: true; protectedByBackup: boolean }
  | { allowed: false; reason: string; action: 'create' | 'back-up' | 'blocked' };

/**
 * Whether this wallet may be spent from.
 *
 * **Receiving and balances are never gated — only signing.** A wallet that cannot receive is
 * useless, and a user who has funded a wallet they cannot recover is the worst outcome this app
 * can produce, so the gate sits exactly where the irreversible step is.
 *
 * Custody is the first argument and not an optional one, deliberately. The old signature took
 * only the vault record, which made it possible — easy, in fact — to permit spending one
 * wallet's money on the strength of another wallet's backup. Now the question cannot be asked
 * without answering "whose money?" first, and the compiler enforces that.
 *
 * `protectedByBackup` is on the success case for the same reason: a caller that allows a spend
 * is handed the fact that nothing is protecting it.
 *
 * The honest limit, unchanged: this is an app rule, not a chain rule. Anyone holding the phrase
 * can spend these funds from other wallet software and nothing here prevents that.
 */
export function spendAllowed(custody: Custody, record: { backedUpAt: number } | null): SpendDecision {
  const source = moneySource(custody);

  if (source === 'blocked') {
    return {
      allowed: false,
      action: 'blocked',
      reason: 'This build cannot open the wallet stored on this phone. Nothing can be sent until it can.',
    };
  }

  // The dev server signs with its own seed. There is no phrase in the app to gate on, and
  // pretending otherwise is the confusion this module exists to prevent.
  if (source === 'dev-server') return { allowed: true, protectedByBackup: false };

  // Demo funds are fictional; the demo flow has its own confirmation and nothing is at stake.
  if (source === 'demo') return { allowed: true, protectedByBackup: false };

  if (!record) {
    return { allowed: false, action: 'create', reason: 'Set up your wallet before sending.' };
  }
  if (!record.backedUpAt) {
    return {
      allowed: false,
      action: 'back-up',
      reason: 'Write down your recovery phrase first. Without it, nothing can bring this wallet back.',
    };
  }
  return { allowed: true, protectedByBackup: true };
}

/**
 * The two environment facts custody depends on, read in one place.
 *
 * `EXPO_PUBLIC_*` values are compiled in at build time, so these are constants for the life of
 * a build — which is why they can be read here rather than threaded through every caller.
 */
export const devServerConfigured = !!(process.env.EXPO_PUBLIC_WALLY_API_URL ?? '');
export const splitPermitted = (process.env.EXPO_PUBLIC_WALLY_ALLOW_SPLIT_WALLET ?? '') === '1';
