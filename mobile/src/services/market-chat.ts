import type { ChatReply } from '../demo/model.ts';
import { COINS } from './market-api.ts';

/** Plain-language summaries for tracked assets. Prices in the card are fetched separately. */
const EXPLAINERS: Record<(typeof COINS)[number]['symbol'], string> = {
  BTC: 'Bitcoin is digital money that runs on a public network instead of a bank. Only 21 million will ever exist, and anyone can check its transactions on a shared ledger.',
  ETH: 'Ethereum is a programmable blockchain. Its coin, ETH, pays network fees, and apps built on it follow shared rules instead of relying on one company.',
  SOL: 'Solana is a blockchain built for fast, low-cost transactions. Its coin, SOL, pays network fees and is staked to help secure the network.',
  USDT: 'Tether (USDt) is a stablecoin designed to stay close to $1. Tether says each token is backed by reserves, so people use it to hold or send dollar value on blockchains.',
};
const ALIASES: Record<string, (typeof COINS)[number]['symbol']> = { bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', ether: 'ETH', solana: 'SOL', sol: 'SOL', tether: 'USDT', usdt: 'USDT' };

/** Market questions answered with an in-chat card, without inference. */
export function quickMarketReply(text: string): ChatReply | null {
  const request = text.trim().replace(/[?!.]+$/, '');
  const asset = request.match(/^(?:explain|tell me about|what(?:'s|’s| is)) (?:the )?(bitcoin|btc|ethereum|eth|ether|solana|sol|tether|usdt)(?: in simple terms)?$/i);
  if (asset) { const symbol = ALIASES[asset[1].toLowerCase()]; return { text: EXPLAINERS[symbol], tool: { kind: 'asset', symbol } }; }
  if (/^(?:show(?: me)? )?(?:the |today(?:'s|’s) )?(?:top|biggest) (?:market )?movers(?: today)?$/i.test(request)) return { text: 'These assets moved the most over the last 24 hours. Tap one to learn more.', tool: { kind: 'movers' } };
  if (/^(?:choose|change|set|pick)(?: my)?(?: display| local)? currency$/i.test(request)) return { text: 'Pick the currency for market prices and charts. Your token quantities do not change.', tool: { kind: 'currency' } };
  return null;
}
