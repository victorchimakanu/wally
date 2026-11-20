/** Frontend-only fixtures and transitions. This module never signs or broadcasts. */
export const DEMO_RECIPIENT = '0x1111111111111111111111111111111111111111';
export const DEMO_ADDRESS = '0x2222222222222222222222222222222222222222';
export const INITIAL_BALANCE = 1_250_000_000;
export const FEE = 20_000;
export type Draft = { recipient: string; amount: string };
export type DraftOrigin = { chatId: string; messageId: string };
export type Quote = Draft & { id: string; expiresAt: number; origin?: DraftOrigin };
export type Transaction = Quote & { status: 'pending' | 'confirmed' | 'failed'; submittedAt: number; fail: boolean };
export type ChatTool =
  | { kind: 'live-balances' | 'live-receive' | 'live-activity' | 'live-send' }
  | { kind: 'balances'; balance: number; offline: boolean; transactionId?: string }
  | { kind: 'receive' | 'market' | 'movers' | 'currency' }
  | { kind: 'asset'; symbol: string }
  | { kind: 'activity'; transactionIds: string[] }
  | { kind: 'clarify'; field: 'recipient' | 'amount' | 'network' }
  | { kind: 'unavailable' | 'timeout' | 'stopped' | 'blocked' | 'insufficient' };
export type ChatReply = { text: string; draft?: Draft; tool?: ChatTool };
export type Message = ChatReply & { id: string; role: 'user' | 'assistant'; draftCancelled?: boolean; draftState?: 'active' | 'superseded' | 'cancelled' | 'submitted'; transactionId?: string };
export type Chat = { id: string; title: string; messages: Message[]; updatedAt: number };
export type DemoState = {
  version: 1; welcomed: boolean; balance: number; offline: boolean; aiPaused: boolean;
  failNext: boolean; quoteSeconds: number; transactions: Transaction[]; chats: Chat[];
};
export function draftStatus(message: Message): NonNullable<Message['draftState']> {
  return message.draftCancelled ? 'cancelled' : message.draftState ?? 'active';
}
/**
 * The most messages one chat keeps.
 *
 * Chat history was unbounded, and store.tsx re-serialises the whole state to AsyncStorage on
 * every state change, so it grew forever and every change paid for all of it. Measured 23 Oct
 * 2026: 5,000 messages is 631 KB and about 1 ms to stringify on a desktop — slow-growing
 * rather than urgent, but it only ever goes one way, and the target device is a low-end
 * Android phone.
 *
 * 200 is far beyond what any conversation uses while staying small to serialise. Only the
 * model's context is what the assistant actually reads, and that is the last 4 messages
 * (recentContext in services/qvac.ts), so trimming old messages changes no reply.
 */
export const MAX_CHAT_MESSAGES = 200;

/** A replacement proposal retires old controls but preserves their history. */
export function appendChatMessages(previous: Message[], incoming: Message[]): Message[] {
  const replacesDraft = incoming.some(message => message.draft);
  const combined = [...previous.map(message => replacesDraft && message.draft && draftStatus(message) === 'active' ? { ...message, draftState: 'superseded' as const } : message), ...incoming];
  // Keep the newest. A draft whose message is trimmed away simply stops being current, which
  // originIsCurrent already treats as "open the latest draft" rather than as an error.
  return combined.length > MAX_CHAT_MESSAGES ? combined.slice(-MAX_CHAT_MESSAGES) : combined;
}
export function originIsCurrent(state: DemoState, origin: DraftOrigin, draft: Draft): boolean {
  const message = state.chats.find(chat => chat.id === origin.chatId)?.messages.find(item => item.id === origin.messageId);
  return !!message?.draft && draftStatus(message) === 'active' && message.draft.amount === draft.amount && message.draft.recipient === draft.recipient;
}
export function initialState(): DemoState {
  return { version: 1, welcomed: false, balance: INITIAL_BALANCE, offline: false, aiPaused: false,
    failNext: false, quoteSeconds: 60, transactions: [], chats: [
      { id: 'sample-send', title: 'Send 25 USDT', updatedAt: 0, messages: [
        { id: 'sample-user', role: 'user', text: `Send 25 USDT on Arbitrum to\n${DEMO_RECIPIENT}` },
        { id: 'sample-reply', role: 'assistant', text: 'I’ve prepared a demo transfer. Review the recipient and fee before you approve.', draft: { recipient: DEMO_RECIPIENT, amount: '25' } },
      ] },
      { id: 'sample-balance', title: 'Checking my balance', updatedAt: 0, messages: [
        { id: 'balance-user', role: 'user', text: 'What is my balance?' },
        { id: 'balance-reply', role: 'assistant', text: 'Your sample balances are 1,250.00 USDT on Arbitrum, 0.042 ETH, and 0.0012 BTC. These are fictional balances.' },
      ] },
    ] };
}
export function units(amount: string): number | null {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(amount)) return null;
  const [whole, fraction = ''] = amount.split('.');
  const value = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function money(value: number): string {
  return (value / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
export function validateDraft(draft: Draft, balance: number): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(draft.recipient) || /^0x0{40}$/.test(draft.recipient)) return 'Enter a complete, non-zero EVM address (0x and 40 characters).';
  const amount = units(draft.amount);
  if (amount === null) return 'Enter a positive amount with up to 6 decimal places.';
  if (amount + FEE > balance) return 'Your demo balance must cover the amount and the 0.02 USDT fee.';
  return null;
}
export function submit(state: DemoState, quote: Quote, now: number): { state: DemoState; error?: string } {
  if (quote.origin && !originIsCurrent(state, quote.origin, quote)) return { state, error: 'This draft changed. Review the latest draft before confirming.' };
  if (state.transactions.some(t => t.id === quote.id)) return { state, error: 'This transfer was already submitted.' };
  if (state.offline) return { state, error: 'Reconnect before requesting a fresh quote.' };
  if (quote.expiresAt <= now) return { state, error: 'This quote expired. Request a new quote.' };
  const error = validateDraft(quote, state.balance);
  if (error) return { state, error };
  return { state: { ...state, balance: state.balance - units(quote.amount)! - FEE, failNext: false,
    transactions: [{ ...quote, submittedAt: now, status: 'pending', fail: state.failNext }, ...state.transactions] } };
}
export function settle(state: DemoState, now: number): DemoState {
  let refund = 0;
  let changed = false;
  const transactions = state.transactions.map(t => {
    if (t.status !== 'pending' || now - t.submittedAt < 4_000) return t;
    changed = true;
    if (t.fail) refund += units(t.amount)! + FEE;
    return { ...t, status: t.fail ? 'failed' as const : 'confirmed' as const };
  });
  return changed ? { ...state, balance: state.balance + refund, transactions } : state;
}
export function scriptedReply(text: string, state: DemoState): ChatReply {
  if (state.aiPaused) return { text: 'Chat is paused. You can still check balances, receive, or use manual send.' };
  if (/^(?:what(?:’s|'s| is) my |check (?:my )?)?balances?\??$/i.test(text.trim())) return { tool: { kind: 'balances', balance: state.balance, offline: state.offline, transactionId: state.transactions[0]?.id }, text: `Your ${state.offline ? 'cached' : 'sample'} balance is ${money(state.balance)} USDT on Arbitrum, plus 0.042 ETH and 0.0012 BTC. All values are demo data.` };
  if (/^(?:what(?:’s|'s| is) my )?(?:receive|address|arbitrum address)\??$/i.test(text.trim())) return { tool: { kind: 'receive' }, text: `Your sample Arbitrum address is ${DEMO_ADDRESS}. This is a frontend demo; do not fund this address.` };
  const match = text.trim().match(/^send\s+(\d+(?:\.\d+)?)\s+USDT\s+(?:on\s+Arbitrum\s+)?to\s+(0x[\da-fA-F]{40})(?:\s+on\s+Arbitrum)?[.!]?$/i);
  if (match) {
    const draft = { amount: match[1], recipient: match[2] };
    const error = validateDraft(draft, state.balance);
    if (error) return { text: error };
    return { draft, text: state.offline ? 'Your draft is saved. Reconnect to get a fresh demo fee and review the details. Nothing will send automatically.' : 'I’ve prepared a demo transfer. Review the recipient and fee before you approve.' };
  }
  if (/\bsend\b/i.test(text)) return { text: 'For this scripted preview, include an amount, USDT, and the full recipient address. Try the example below, or use manual send. Only Arbitrum USDT transfers are simulated.' };
  return { text: 'I can show your balance, your receive address, or prepare a demo USDT transfer on Arbitrum. This preview uses scripted replies; a local AI model is not connected.' };
}
