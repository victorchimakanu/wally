import { getDb } from "../db/index.js";
import type { CompletionMessage } from "../types.js";

export interface SessionRow {
  id: string;
  created_at: number;
  last_seen: number;
  history: string;
}

export function upsertSession(id: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id) VALUES (?)
    ON CONFLICT(id) DO UPDATE SET last_seen = unixepoch()
  `).run(id);
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

// listSessions returns recent sessions that contain at least one message,
// newest first, titled by their first user message.
export function listSessions(limit = 30): SessionSummary[] {
  const rows = getDb()
    .prepare("SELECT id, last_seen, history FROM sessions WHERE history != '[]' ORDER BY last_seen DESC LIMIT ?")
    .all(limit) as SessionRow[];

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
