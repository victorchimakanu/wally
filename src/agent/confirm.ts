import { randomUUID } from "node:crypto";
import type { ConfirmationPayload } from "../types.js";

const CONFIRMATION_TIMEOUT_MS = 60_000;

// One pending confirmation per session. Only one financial operation can be
// in-flight at a time — confirming one cancels any previous pending confirmation.
interface PendingConfirmation {
  payload: ConfirmationPayload;
  resolve: (confirmed: boolean) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingConfirmation>();

// create returns the payload to send to the UI and a promise that resolves
// when the user confirms or cancels (or the 60s timeout expires).
export function createConfirmation(
  sessionId: string,
  action: string,
  amount: string,
  tokenSymbol: string,
  recipient: string,
  chain: string,
  fee: string
): { payload: ConfirmationPayload; promise: Promise<boolean> } {
  // Cancel any existing confirmation for this session
  cancelConfirmation(sessionId);

  const token = randomUUID();
  const payload: ConfirmationPayload = {
    token,
    action,
    amount,
    token_symbol: tokenSymbol,
    recipient,
    chain,
    fee,
  };

  let resolver!: (confirmed: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolver = resolve;
  });

  const timer = setTimeout(() => {
    const entry = pending.get(sessionId);
    if (entry?.payload.token === token) {
      pending.delete(sessionId);
      resolver(false); // timeout = cancel
    }
  }, CONFIRMATION_TIMEOUT_MS);

  pending.set(sessionId, { payload, resolve: resolver, timer });

  return { payload, promise };
}

// resolveConfirmation is called when the user clicks Confirm or Cancel in the UI.
export function resolveConfirmation(
  sessionId: string,
  token: string,
  confirmed: boolean
): boolean {
  const entry = pending.get(sessionId);
  if (!entry || entry.payload.token !== token) return false;

  clearTimeout(entry.timer);
  pending.delete(sessionId);
  entry.resolve(confirmed);
  return true;
}

// cancelConfirmation clears any pending confirmation without resolving it.
export function cancelConfirmation(sessionId: string): void {
  const entry = pending.get(sessionId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(sessionId);
  entry.resolve(false);
}

export function hasPendingConfirmation(sessionId: string): boolean {
  return pending.has(sessionId);
}
