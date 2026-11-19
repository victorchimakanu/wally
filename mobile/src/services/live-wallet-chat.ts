import type { ChatReply } from '../demo/model.ts';
import type { WalletIntent, ChatIntent } from './qvac.ts';
import { CHAINS, type Chain } from './wallet-api.ts';
import { tokensFor } from './tokens.ts';

/**
 * What chat says the live wallet can do.
 *
 * ## Why these sentences are built rather than written
 *
 * This file told people **"USDt transfers are not configured"** for eleven days after the USDt
 * send path shipped, and **"USDt balances are not connected"** for thirteen days after the
 * balance started flowing. Both were true when they were written and neither moved when the
 * feature landed, because a sentence in a string literal has nothing to do with the code that
 * made it false. Meanwhile Send grew an asset picker from `tokensFor()` and would happily send
 * the thing chat was denying existed.
 *
 * That is worse than an out-of-date document. A user who asks Wally whether it can move their
 * USDt is told no, by the wallet that can, and stops there.
 *
 * So the asset sentences below are derived from the same token list the Send screen reads.
 * Add a token to `tokens.ts` and chat describes it on that commit; remove one and chat stops
 * claiming it. `test/live-chat-copy.test.ts` fails if any of these replies says a connected
 * asset is unavailable, so the two cannot drift apart again without the build noticing.
 */

/** The chains this wallet connects, in display order. */
const CHAIN_ORDER = ['arbitrum', 'ethereum'] as const satisfies readonly Chain[];

/** Every token this wallet connects, with the network it lives on. Exported for the test. */
export function tokenAssets(): readonly { symbol: string; chain: Chain }[] {
  return CHAIN_ORDER.flatMap(chain => tokensFor(chain).map(token => ({ symbol: token.symbol, chain })));
}

/** The app writes Tether's symbol as USDt; the contract calls itself USDT. */
function display(symbol: string): string {
  return symbol === 'USDT' ? 'USDt' : symbol;
}

function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`;
}

/** "testnet ETH on Arbitrum Sepolia and Ethereum Sepolia, and testnet USDt on Arbitrum Sepolia" */
function assetPhrase(): string {
  const native = `testnet ETH on ${list(CHAIN_ORDER.map(chain => CHAINS[chain].name))}`;
  const tokens = list(tokenAssets().map(asset => `testnet ${display(asset.symbol)} on ${CHAINS[asset.chain].name}`));
  return tokens ? `${native}, and ${tokens}` : native;
}

export function liveIntentReply(intent: ChatIntent | WalletIntent): ChatReply {
  if (intent.intent === 'chat') return { text: intent.reply };
  if (intent.intent === 'balance') {
    // Bitcoin first: there is no Bitcoin chain here at all, so no token lookup can answer it.
    if (intent.token === 'BTC' || intent.chain === 'bitcoin') return { text: `Bitcoin is not connected. This wallet reads ${assetPhrase()}.`, tool: { kind: 'live-balances' } };
    const connected = tokenAssets().find(asset => asset.symbol === intent.token);
    const named = intent.token !== 'unknown' && intent.token !== 'ETH';
    if (named && !connected) return { text: `${display(intent.token)} is not connected. This wallet reads ${assetPhrase()}.`, tool: { kind: 'live-balances' } };
    // Right asset, wrong network. Saying "not connected" here would be false, and saying
    // nothing would leave someone looking for a balance on a chain that cannot hold it.
    if (connected && intent.chain !== connected.chain && intent.chain !== 'all' && intent.chain !== 'unknown') {
      const elsewhere = intent.chain === 'arbitrum' || intent.chain === 'ethereum' ? ` ${CHAINS[intent.chain].name} is native ETH only.` : '';
      return { text: `${display(connected.symbol)} is connected on ${CHAINS[connected.chain].name} only.${elsewhere} Your balances are below.`, tool: { kind: 'live-balances' } };
    }
    return { text: `Here are your balances — ${assetPhrase()}. The card reads the wallet API and marks saved data when it cannot refresh.`, tool: { kind: 'live-balances' } };
  }
  if (intent.intent === 'address') return { text: `Choose your test network below to copy your actual receive address. It receives ${assetPhrase()}. Test assets only — they have no monetary value.`, tool: { kind: 'live-receive' } };
  if (intent.intent === 'history') return { text: 'Here is activity fetched from the explorers and actual network receipts. Errors are shown if history is incomplete.', tool: { kind: 'live-activity' } };
  // Chat never fills in an amount or a recipient, whatever the model parsed. Send opens empty.
  if (intent.intent === 'transfer') return { text: `Use Send to choose the network and the asset — ${assetPhrase()} — then enter the amount and recipient and review the real fee. Fees are always paid in ETH. Nothing has been submitted.`, tool: { kind: 'live-send' } };
  return { text: `I can show your balances (${assetPhrase()}), your receive address, market prices and on-chain activity. Use Send to review and approve a transfer.` };
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
