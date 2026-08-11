// Shared types used across the codebase.

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Every message Wally sends over WebSocket has this shape.
export type WallyOutboundEvent =
  | { type: "message"; content: string; streaming?: boolean }
  | { type: "typing" }
  | { type: "confirmation"; payload: ConfirmationPayload }
  | { type: "balance"; balances: ChainBalance[] }
  | { type: "tx_complete"; txHash: string; chain: string; explorerUrl: string }
  | { type: "error"; message: string }
  | { type: "connected"; sessionId?: string; networkMode: "testnet" | "mainnet" }
  | { type: "address"; chain: string; address: string }
  | { type: "history"; messages: CompletionMessage[] };

// Every message the browser sends to Wally has this shape.
export type WallyInboundEvent =
  | { type: "message"; content: string }
  | { type: "confirm"; token: string }
  | { type: "cancel"; token: string }
  | { type: "get_balance" }
  | { type: "get_address"; chain: string };

export interface ConfirmationPayload {
  token: string;    // short-lived UUID linking confirm/cancel back to the pending op
  action: string;   // e.g. "Send 10 USDT on Ethereum"
  amount: string;
  token_symbol: string;
  recipient: string;
  chain: string;
  fee: string;
}

export interface ChainBalance {
  chain: string;
  token: string;
  amount: string;
}
