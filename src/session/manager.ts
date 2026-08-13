import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import { WallyAgent } from "../agent/index.js";
import { upsertSession, touchSession, getSession, deleteExpiredSessions } from "./store.js";
import { resolveConfirmation } from "../agent/confirm.js";
import { fetchAddress } from "../wdk/tools.js";
import { getLogger, scrubSecrets } from "../logger.js";
import type { WallyInboundEvent, WallyOutboundEvent } from "../types.js";

const log = getLogger("session:manager");

interface Session {
  id: string;
  agent: WallyAgent;
  ws: WebSocket | null;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

// getOrCreateSession resumes a known session or creates a new one. `owner` is
// applied only when creating a fresh session, so every session a client makes
// (first visit, and later "new chat") shares one owner id. Sessions are only
// listable and switchable within their owner (see server.ts).
export function getOrCreateSession(existingId?: string, owner?: string): string {
  // Resume a session if it is live in memory OR persisted in SQLite — the
  // in-memory reaper prunes idle agents, but chat history lives on disk and
  // must remain resumable from the session sidebar.
  const known =
    existingId !== undefined &&
    (sessions.has(existingId) || getSession(existingId) !== undefined);
  const id = known ? existingId! : randomUUID();

  if (!sessions.has(id)) {
    const agent = new WallyAgent(id, (event) => emitToSession(id, event));
    sessions.set(id, { id, agent, ws: null, lastSeen: Date.now() });
    // Only stamp an owner on a genuinely new row; resuming keeps the existing one.
    upsertSession(id, known ? undefined : owner ?? randomUUID());
    log.info({ session_id: id }, "Session created");
  }

  return id;
}

export function bindWebSocket(sessionId: string, ws: WebSocket): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.ws = ws;
  session.lastSeen = Date.now();
  touchSession(sessionId);
}

export function unbindWebSocket(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.ws = null;
  log.info({ session_id: sessionId }, "WebSocket disconnected — session kept");
}

export async function handleInbound(
  sessionId: string,
  raw: string
): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.lastSeen = Date.now();
  touchSession(sessionId);

  let event: WallyInboundEvent;
  try {
    event = JSON.parse(raw) as WallyInboundEvent;
  } catch {
    emitToSession(sessionId, { type: "error", message: "Invalid message format" });
    return;
  }

  // Address lookup bypasses QVAC — direct WDK call.
  if (event.type === "get_address") {
    try {
      const address = await fetchAddress(event.chain);
      emitToSession(sessionId, { type: "address", chain: event.chain, address });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not fetch address";
      emitToSession(sessionId, { type: "error", message: "Address lookup failed: " + message });
    }
    return;
  }

  // Confirmation events bypass the agent and go directly to confirm.ts
  if (event.type === "confirm" || event.type === "cancel") {
    if (!("token" in event)) {
      emitToSession(sessionId, { type: "error", message: "Missing token in confirmation" });
      return;
    }
    const resolved = resolveConfirmation(
      sessionId,
      event.token,
      event.type === "confirm"
    );
    if (!resolved) {
      emitToSession(sessionId, {
        type: "error",
        message: "Confirmation expired or not found",
      });
    }
    return;
  }

  await session.agent.handleMessage(event);
}

function emitToSession(sessionId: string, event: WallyOutboundEvent): void {
  const session = sessions.get(sessionId);
  if (!session?.ws) return;
  // Single chokepoint: scrub any secret material (API keys, bearer tokens,
  // keyed URLs) out of text that reaches the browser. Error messages can carry
  // a failed bundler/paymaster URL with its apikey; this strips it.
  const safe =
    event.type === "error"
      ? { ...event, message: scrubSecrets(event.message) }
      : event.type === "message"
        ? { ...event, content: scrubSecrets(event.content) }
        : event;
  try {
    session.ws.send(JSON.stringify(safe));
  } catch (err) {
    log.warn({ session_id: sessionId, err }, "Failed to emit to session WebSocket");
  }
}

// Prune sessions with no WebSocket activity for 30 minutes — both from the
// in-memory map AND from SQLite, so the sessions table (and its stored chat
// history) does not grow without bound over a long-running instance.
export function startSessionReaper(intervalMs = 60_000): NodeJS.Timeout {
  return setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.ws === null && session.lastSeen < cutoff) {
        sessions.delete(id);
        log.info({ session_id: id }, "Session reaped");
      }
    }
    // Persisted rows older than a day of inactivity are removed from disk.
    try {
      const removed = deleteExpiredSessions(24 * 60 * 60);
      if (removed > 0) log.info({ removed }, "Expired session rows pruned from disk");
    } catch (err) {
      log.warn({ err }, "Failed to prune expired session rows");
    }
  }, intervalMs);
}
