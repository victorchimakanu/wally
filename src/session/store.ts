import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import type { CompletionMessage } from "../types.js";

export interface SessionRow {
  id: string;
  owner: string | null;
  created_at: number;
  last_seen: number;
  history: string;
}

export function upsertSession(id: string, owner?: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, owner) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = unixepoch()
  `).run(id, owner ?? null);
}

export function getSessionOwner(id: string): string | null {
  const row = getDb().prepare("SELECT owner FROM sessions WHERE id = ?").get(id) as { owner: string | null } | undefined;
  return row?.owner ?? null;
}

// ensureSessionOwner returns the session's owner, backfilling a random one for
// legacy rows created before the owner column existed. Keeps a null-owner
// session from being locked out of listing/switching its own chats.
export function ensureSessionOwner(id: string): string {
  const existing = getSessionOwner(id);
  if (existing) return existing;
  const owner = randomUUID();
  getDb().prepare("UPDATE sessions SET owner = ? WHERE id = ?").run(owner, id);
  return owner;
}

export function touchSession(id: string): void {
  getDb()
    .prepare("UPDATE sessions SET last_seen = unixepoch() WHERE id = ?")
    .run(id);
}

export function getSession(id: string): SessionRow | undefined {
  return getDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(id) as SessionRow | undefined;
}

export function saveHistory(id: string, history: CompletionMessage[]): void {
  getDb()
    .prepare("UPDATE sessions SET history = ?, last_seen = unixepoch() WHERE id = ?")
    .run(JSON.stringify(history), id);
}

export function loadHistory(id: string): CompletionMessage[] {
  const row = getSession(id);
  if (!row) return [];
  try {
    return JSON.parse(row.history) as CompletionMessage[];
  } catch {
    return [];
  }
}

export interface SessionSummary {
  id: string;
  title: string;
  lastSeen: number;
}

// listSessions returns recent sessions BELONGING TO one owner that contain at
// least one message, newest first, titled by their first user message. Scoping
// by owner prevents one client from enumerating another's session IDs.
export function listSessions(owner: string, limit = 30): SessionSummary[] {
  const rows = getDb()
    .prepare("SELECT id, last_seen, history FROM sessions WHERE owner = ? AND history != '[]' ORDER BY last_seen DESC LIMIT ?")
    .all(owner, limit) as SessionRow[];

  const summaries: SessionSummary[] = [];
  for (const row of rows) {
    let title = "untitled chat";
    try {
      const history = JSON.parse(row.history) as CompletionMessage[];
      const firstUser = history.find((m) => m.role === "user");
      if (!firstUser) continue; // nothing user-visible in it yet
      title = firstUser.content.slice(0, 60);
    } catch {
      continue;
    }
    summaries.push({ id: row.id, title, lastSeen: row.last_seen });
  }
  return summaries;
}

export function deleteExpiredSessions(maxInactivitySeconds = 1800): number {
  const cutoff = Math.floor(Date.now() / 1000) - maxInactivitySeconds;
  const result = getDb()
    .prepare("DELETE FROM sessions WHERE last_seen < ?")
    .run(cutoff);
  return result.changes;
}
