/**
 * One sentence naming what this wallet holds, built from the token list.
 *
 * ## Why this is a module and not a string
 *
 * The same claim — *which assets are connected* — has now been written by hand on four separate
 * surfaces, and every one of them went stale in the same direction after USDt shipped on
 * 8 November 2026:
 *
 * | Surface | Said | Wrong for |
 * |---|---|---|
 * | Chat replies (`live-wallet-chat.ts`) | "USDt transfers are not configured" | 11 days |
 * | Wallet screen footnote (`WalletData.tsx`) | "sending it is not built yet" | 11 days |
 * | Receive screen (`receive-advice.ts`) | "Send only testnet ETH" | 3 weeks |
 * | The QVAC system prompt (`qvac.ts`) | "USDt and Bitcoin are not configured" | 3 weeks |
 *
 * Each was true when written. None moved when the feature landed, because a sentence in a
 * string literal has no relationship to the code that makes it false. The first two were fixed
 * one at a time, separately, which is how the third and fourth survived — fixing an instance
 * does not fix the class.
 *
 * The prompt is the worst of the four and the reason this module exists. A fixed string is
 * wrong predictably; an instruction to a sampling model is wrong *sometimes*, so a single
 * transcript that reads fine proves nothing. Measured on 19 Nov 2026 against the running
 * model, a fresh conversation asking "can I send USDt?" was told **no in three samples out of
 * three**.
 *
 * So the sentence is derived, once, here. Add a token to `tokens.ts` and every surface says so
 * on that commit. `test/asset-copy.test.ts` fails if any of them stops reading this.
 */
import { CHAINS, type Chain } from './wallet-api.ts';
import { assetNamesOn, displaySymbol, tokensFor } from './tokens.ts';

/** The chains this wallet connects, in display order. */
export const CHAIN_ORDER = ['arbitrum', 'ethereum'] as const satisfies readonly Chain[];

/** "a, b and c" — Oxford-less, matching the rest of the product's copy. */
export function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/** Every token this wallet connects, with the network it lives on. */
export function tokenAssets(): readonly { symbol: string; chain: Chain }[] {
  return CHAIN_ORDER.flatMap(chain => tokensFor(chain).map(token => ({ symbol: token.symbol, chain })));
}

/**
 * "testnet ETH on Arbitrum Sepolia and Ethereum Sepolia, and testnet USDt on Arbitrum Sepolia"
 *
 * The whole-wallet phrase, for chat and for the model's instructions.
 */
export function assetPhrase(): string {
  const native = `testnet ETH on ${list(CHAIN_ORDER.map(chain => CHAINS[chain].name))}`;
  const tokens = list(tokenAssets().map(asset => `testnet ${displaySymbol(asset.symbol)} on ${CHAINS[asset.chain].name}`));
  return tokens ? `${native}, and ${tokens}` : native;
}

/**
 * "testnet ETH" or "testnet ETH and testnet USDt" — one chain, no network names.
 *
 * For the Receive screen, which has already named the network in the same sentence.
 */
export function chainAssetPhrase(chain: Chain): string {
  return list(assetNamesOn(chain).map(symbol => `testnet ${symbol}`));
}
