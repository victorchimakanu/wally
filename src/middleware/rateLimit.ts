// Per-session rate limiter stored in memory.
// Limits: 10 messages per minute, 3 transfer attempts per hour.

interface Bucket {
  messages: number[];     // timestamps (ms) of recent messages
  transfers: number[];    // timestamps (ms) of recent transfer attempts
}

const buckets = new Map<string, Bucket>();

function getBucket(sessionId: string): Bucket {
  let b = buckets.get(sessionId);
  if (!b) {
    b = { messages: [], transfers: [] };
    buckets.set(sessionId, b);
  }
  return b;
}

export function checkMessageRate(sessionId: string): boolean {
  const now = Date.now();
  const b = getBucket(sessionId);
  const windowMs = 60_000;
  b.messages = b.messages.filter((t) => now - t < windowMs);
  if (b.messages.length >= 10) return false;
  b.messages.push(now);
  return true;
}

export function checkTransferRate(sessionId: string): boolean {
  const now = Date.now();
  const b = getBucket(sessionId);
  const windowMs = 3_600_000;
  b.transfers = b.transfers.filter((t) => now - t < windowMs);
  if (b.transfers.length >= 3) return false;
  b.transfers.push(now);
  return true;
}

export function clearBucket(sessionId: string): void {
  buckets.delete(sessionId);
}

// Global wallet-operation limiter. Per-session buckets alone are defeatable
// by minting fresh sessions, so executed spends are also capped process-wide:
// 10 wallet operations (transfer/swap/lend) per hour, whoever asks.
//
// Split into peek and consume so that only spends that actually EXECUTE count.
// Peeking at handler entry rejects early when already at the ceiling; consume
// runs after the human confirmation, so cancelled or quote-failed ops (which
// never sign) do not burn the budget.
const GLOBAL_LIMIT = 10;
const GLOBAL_WINDOW_MS = 3_600_000;
const globalOps: number[] = [];

function pruneGlobal(now: number): void {
  while (globalOps.length > 0 && now - globalOps[0]! >= GLOBAL_WINDOW_MS) globalOps.shift();
}

// peekGlobalOpRate returns true if a spend is currently allowed, WITHOUT
// consuming a slot.
export function peekGlobalOpRate(): boolean {
  pruneGlobal(Date.now());
  return globalOps.length < GLOBAL_LIMIT;
}

// consumeGlobalOpRate records one executed spend. Returns false if the ceiling
// was already reached (caller should abort before signing).
export function consumeGlobalOpRate(): boolean {
  const now = Date.now();
  pruneGlobal(now);
  if (globalOps.length >= GLOBAL_LIMIT) return false;
  globalOps.push(now);
  return true;
}

// Global chat-message ceiling: bounds on-device model compute across all
// sessions so per-session limits cannot be bypassed by minting sessions.
const GLOBAL_MSG_LIMIT = 60;
const globalMsgs: number[] = [];

export function checkGlobalMessageRate(): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  while (globalMsgs.length > 0 && now - globalMsgs[0]! >= windowMs) globalMsgs.shift();
  if (globalMsgs.length >= GLOBAL_MSG_LIMIT) return false;
  globalMsgs.push(now);
  return true;
}
