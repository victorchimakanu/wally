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
import { COINS } from './market-api.ts';

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

/**
 * Which asset a sentence is asking about, or null when it names none this app knows.
 *
 * Both halves are derived. What the wallet **holds** comes from `tokens.ts` through
 * `tokenAssets()`, plus native ETH. What it merely **knows the price of** comes from `COINS` in
 * `market-api.ts`, which is the Market screen's own list. Nothing is written down twice, so
 * pinning a token or adding a coin moves this with it.
 *
 * Null for an unrecognised word rather than a guess: "can I send FOO" from someone who means
 * nothing in particular should reach the model, not get a confident denial about a ticker this
 * app has never heard of.
 */
export function namedAsset(text: string): { label: string; chain: Chain | null } | null {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
  // Held assets first: a word that matches one of these is answered from the wallet, not from
  // the price list, even though USDT appears in both.
  for (const asset of tokenAssets()) {
    const token = tokensFor(asset.chain).find(entry => entry.symbol === asset.symbol);
    const aliases = [asset.symbol, displaySymbol(asset.symbol), token?.issuer ?? ''];
    if (aliases.some(alias => alias && words.has(alias.toLowerCase()))) {
      return { label: displaySymbol(asset.symbol), chain: asset.chain };
    }
  }
  if (words.has('eth') || words.has('ethereum')) return { label: 'ETH', chain: null };
  for (const coin of COINS) {
    if (words.has(coin.symbol.toLowerCase()) || words.has(coin.name.toLowerCase())) {
      return { label: coin.name, chain: null };
    }
  }
  return null;
}

/**
 * The answer to "can I hold / send / use <asset> here", or null when that is not the question.
 *
 * ## Why this is not left to the model
 *
 * It was, and the model got it wrong. Measured against the running QVAC server on 19 Nov 2026,
 * with the system prompt replayed exactly as `qvac.ts` sends it:
 *
 * ```
 * ORIGINAL prompt   USDt 0/5   ETH 5/5   BTC hold 2/5   BTC send 0/5
 * fixed prompt      USDt 5/5   ETH 5/5   BTC hold 2/5   BTC send 5/5
 * ```
 *
 * Fixing the prompt's stale claim moved USDt from 0/5 to 5/5. It did **not** move "can I hold
 * Bitcoin", which sat at 2/5 before and after — so that cell is not a stale-copy problem at
 * all. It is a 35-word instruction to a small local model being asked to carry an affirmation
 * and a denial at once, and three wordings measured in a row failed to carry both.
 *
 * Which asset a wallet holds is a **fact the app already has**, in the same list the Send
 * screen builds its picker from. Sampling it was the mistake. This is the same principle the
 * whole app is built on — the model reads the sentence, code supplies the values — applied to a
 * fact rather than to an amount.
 *
 * The model still handles everything that is genuinely a question of language. This only takes
 * the questions that have a lookup for an answer.
 */
export function assetSupportAnswer(text: string): string | null {
  const request = text.trim();
  // A support question, not a transfer instruction: "send 5 USDt to 0x…" must keep going to the
  // transfer path, which opens Send. The leading verb is what separates them.
  if (/^(?:send|transfer|pay)\b/i.test(request)) return null;
  if (!/\b(?:can|could|does|do|is|are|will)\b/i.test(request)) return null;
  if (!/\b(?:hold|holds|send|sending|store|keep|use|support|supports|supported|transfer|receive|accept)\b/i.test(request)) return null;

  const asset = namedAsset(request);
  if (!asset) return null;

  if (asset.chain) {
    return `Yes. ${asset.label} is connected on ${CHAINS[asset.chain].name}. Use Send to review a transfer — Wally fills in nothing for you.`;
  }
  if (asset.label === 'ETH') {
    return `Yes. testnet ETH is connected on ${list(CHAIN_ORDER.map(chain => CHAINS[chain].name))}. Use Send to review a transfer — Wally fills in nothing for you.`;
  }
  // Known to the Market screen, not held by the wallet. Said as two separate facts, because
  // "you can see its price" is the part a person is usually surprised by.
  return `No. ${asset.label} is not connected, so this wallet cannot hold or send it. You can still see its price under Market. This wallet holds ${assetPhrase()}.`;
}
