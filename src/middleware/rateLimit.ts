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
