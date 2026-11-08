import type { Currency, MarketAsset } from './market-api.ts';

/**
 * What a balance is worth in the money someone actually thinks in.
 *
 * "0.042 ETH" means nothing to most people. "₦180,000" means something, and for a product whose
 * one-line pitch is *keep your money in dollars, spend it in Naira*, that gap is the product.
 *
 * **It is built and not shown yet, deliberately.** Every balance in this app is testnet, and
 * testnet tokens are worth nothing — the app says so on every screen. Putting a naira figure
 * beside one would contradict the only honest thing it currently says about value, so
 * `fiatDisplayable()` gates it on the chain being a mainnet, and today that is false
 * everywhere. The arithmetic and its rounding are settled now so that turning it on later is a
 * flag rather than a feature.
 *
 * Nothing here invents a price. An asset with no price returns null and the screen shows
 * nothing, exactly as a missing balance shows "Unavailable" rather than zero.
 */

export type FiatValue = {
  /** The amount in the chosen currency, or null when it cannot be known. */
  amount: number | null;
  /** The currency it is in, so a caller cannot format it as the wrong one. */
  currency: Currency;
};

/**
 * Whether a fiat figure may be shown at all.
 *
 * The whole gate, in one place. `testnet` is what the wallet reports about itself, so this
 * cannot be switched on by accident in a build that is still on Sepolia.
 */
export function fiatDisplayable(input: { network: string | undefined }): boolean {
  return input.network === 'mainnet';
}

/**
 * One balance, converted.
 *
 * Takes the display amount as a string because that is what the wallet snapshot carries, and
 * parses it here rather than making every caller remember the asset's decimals. A string that
 * is not a number returns null rather than NaN, which would format as "NaN" on screen.
 */
export function fiatValue(
  amount: string | null,
  symbol: string,
  assets: readonly MarketAsset[],
  currency: Currency,
): FiatValue {
  if (amount === null) return { amount: null, currency };
  const held = Number(amount);
  if (!Number.isFinite(held) || held < 0) return { amount: null, currency };

  const asset = assets.find(entry => entry.symbol.toUpperCase() === symbol.toUpperCase());
  // A price in the wrong currency is worse than no price: it would be formatted as naira
  // while being dollars. The market snapshot is fetched per currency, so this can happen.
  if (!asset || asset.price === null || asset.currency !== currency) return { amount: null, currency };

  return { amount: held * asset.price, currency };
}

/**
 * Several balances added up, in one currency.
 *
 * Returns null if **any** of them could not be priced. A total that silently omits an asset is
 * the kind of wrong that looks right — the same reason the wallet screen already refuses to
 * total a network whose balance failed to refresh.
 */
export function fiatTotal(
  balances: readonly { amount: string | null; symbol: string }[],
  assets: readonly MarketAsset[],
  currency: Currency,
): FiatValue {
  let total = 0;
  for (const balance of balances) {
    const value = fiatValue(balance.amount, balance.symbol, assets, currency);
    if (value.amount === null) return { amount: null, currency };
    total += value.amount;
  }
  return { amount: total, currency };
}
