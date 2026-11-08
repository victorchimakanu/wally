import type { ChatReply } from '../demo/model.ts';
import type { WalletIntent, ChatIntent } from './qvac.ts';

export function liveIntentReply(intent: ChatIntent | WalletIntent): ChatReply {
  if (intent.intent === 'chat') return { text: intent.reply };
  if (intent.intent === 'balance') {
    if (intent.token === 'USDT' || intent.token === 'BTC' || intent.chain === 'bitcoin') return { text: 'This wallet currently connects native testnet ETH on Arbitrum Sepolia and Ethereum Sepolia. USDt and Bitcoin balances are not connected.', tool: { kind: 'live-balances' } };
    return { text: 'Here are your testnet ETH balances. The card reads the wallet API and marks saved data when it cannot refresh.', tool: { kind: 'live-balances' } };
  }
  if (intent.intent === 'address') return { text: 'Choose your test network below to copy your actual receive address. Use testnet ETH only.', tool: { kind: 'live-receive' } };
  if (intent.intent === 'history') return { text: 'Here is activity fetched from the explorers and actual network receipts. Errors are shown if history is incomplete.', tool: { kind: 'live-activity' } };
  if (intent.intent === 'transfer') return { text: 'Use Send to choose Arbitrum Sepolia or Ethereum Sepolia, enter a testnet ETH amount and recipient, then review the real fee. USDt transfers are not configured. Nothing has been submitted.', tool: { kind: 'live-send' } };
  return { text: 'I can show testnet ETH balances, your receive address, market prices and on-chain activity. Use Send to review and approve an ETH transfer.' };
}
export function quickLiveReply(text: string): ChatReply | null {
  const request = text.trim().replace(/[?!.]+$/, '');
  const base = { chain: 'all' as const, token: 'unknown' as const, amount: '', recipient: '' };
  if (/^(?:show(?: me)?(?: today(?:'s|’s))?(?: the)? )?(?:crypto )?market(?: prices)?$/i.test(request)) return { text: 'Here are fetched market prices. They are separate from your testnet wallet.', tool: { kind: 'market' } };
  if (/^(?:(?:what(?:'s|’s| is| are) (?:my|the)|(?:show|check)(?: me)?(?: my)?) )?(?:wallet )?balances?$/i.test(request) || /^how much (?:ETH|USDT|BTC) do I have(?: on (?:Arbitrum|Ethereum|Bitcoin))?$/i.test(request)) return liveIntentReply({ ...base, intent: 'balance' });
  if (/^(?:(?:what(?:'s|’s| is) my|(?:show|view)(?: me)?(?: my)?) )?(?:(?:Arbitrum|Ethereum|testnet) )?(?:receive )?address$/i.test(request)) return liveIntentReply({ ...base, intent: 'address' });
  if (/^(?:(?:show|view|check)(?: me)?(?: my)? )?(?:transaction |transfer )?history$/i.test(request)) return liveIntentReply({ ...base, intent: 'history' });
  if (/^(?:send|transfer|pay)\b/i.test(request)) return liveIntentReply({ ...base, intent: 'transfer' });
  return null;
}
