import { DEMO_RECIPIENT } from '../demo/model.ts';
import { COINS, type MarketAsset } from './market-api.ts';
import type { LiveHistory, WalletSnapshot } from './wallet-api.ts';

/** Suggestions answer inside the chat; the only screen they open is another conversation. */
export type SuggestionAction = { kind: 'send'; text: string } | { kind: 'open'; pathname: '/chat'; params: Record<string, string> };
export type Suggestion = { label: string; action: SuggestionAction };
export type SuggestionContext = {
  /** Asset symbol the user was viewing when the chat opened. */
  topic?: string;
  live: boolean;
  wallet: WalletSnapshot | null;
  history: LiveHistory | null;
  market: MarketAsset[];
  /** Another conversation with messages the user can pick up again. */
  recent?: { id: string; title: string };
  /** Requests already sent in this conversation; they are never suggested again. */
  asked: string[];
};

const ask = (label: string, text = label): Suggestion => ({ label, action: { kind: 'send', text } });
const BALANCES = ask('Show my wallet balances', 'What is my balance?');
const ADDRESS = ask('Show my receive address', 'What is my Arbitrum address?');
const MARKET = ask('Show today’s crypto market', 'Show crypto market');
/** Moves at least this large (24h, percent) are worth surfacing. */
const NOTABLE_MOVE = 3;

function funded(wallet: WalletSnapshot | null): boolean | null {
  if (!wallet) return null;
  return wallet.balances.some(item => item.balanceWei !== null && BigInt(item.balanceWei) > 0n);
}

/** Wallet action that fits the current balance: send when funded, receive when empty. */
export function primarySuggestion({ live, wallet }: Pick<SuggestionContext, 'live' | 'wallet'>): Suggestion {
  if (!live) return ask('Send 25 USDt to Victor', `Send 25 USDT on Arbitrum to ${DEMO_RECIPIENT}`);
  return funded(wallet) === false ? { ...ADDRESS, label: 'Get my address to receive testnet ETH' } : ask('Send testnet ETH');
}

function topicSuggestions(symbol: string, context: SuggestionContext): Suggestion[] {
  const name = context.market.find(asset => asset.symbol === symbol)?.name ?? COINS.find(coin => coin.symbol === symbol)?.name ?? symbol;
  const explain = ask(`Explain ${name} in simple terms`);
  if (symbol === 'ETH' && context.live) return [explain, primarySuggestion(context), { ...BALANCES, label: 'Show my testnet ETH balance' }, ask('What affects Ethereum’s price?')];
  if (symbol === 'USDT') return [explain, ask('What is a stablecoin?'), ask('How does USDt keep its value at $1?'), MARKET];
  return [explain, ask(`How is ${name} different from Ethereum?`), ask(`What affects ${name}’s price?`), MARKET];
}

function generalSuggestions(context: SuggestionContext): Suggestion[] {
  const items = [primarySuggestion(context)];
  if (context.live && context.history?.items.some(item => item.status === 'pending')) items.push(ask('Check my pending transfer', 'Show my transaction history'));
  const mover = context.market.filter(asset => asset.symbol !== 'USDT' && asset.change !== null && Math.abs(asset.change) >= NOTABLE_MOVE).sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))[0];
  if (mover) items.push({ label: `Check ${mover.name}, ${mover.change! > 0 ? 'up' : 'down'} ${Math.abs(mover.change!).toFixed(1)}% today`, action: { kind: 'send', text: `Explain ${mover.name}` } });
  if (context.recent) items.push({ label: `Continue “${context.recent.title.length > 32 ? `${context.recent.title.slice(0, 31).trimEnd()}…` : context.recent.title}”`, action: { kind: 'open', pathname: '/chat', params: { id: context.recent.id } } });
  return [...items, BALANCES, MARKET];
}

/** Up to three starting suggestions, ranked by what the user is looking at and what their wallet can do. */
export function chatSuggestions(context: SuggestionContext): Suggestion[] {
  const asked = new Set(context.asked.map(text => text.trim().toLowerCase()));
  const topic = context.topic && COINS.some(coin => coin.symbol === context.topic) ? context.topic : undefined;
  const items = topic ? topicSuggestions(topic, context) : generalSuggestions(context);
  return items.filter(item => item.action.kind !== 'send' || !asked.has(item.action.text.toLowerCase())).slice(0, 3);
}
