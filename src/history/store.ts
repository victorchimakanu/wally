import { getDb } from "../db/index.js";

export interface TxRecord {
  id?: number;
  session_id: string;
  chain: string;
  token: string;
  amount: string;
  recipient: string;
  tx_hash: string;
  fee: string;
  status: "pending" | "confirmed" | "failed";
  created_at?: number;
}

export function insertTx(tx: Omit<TxRecord, "id" | "created_at">): number {
  const result = getDb()
    .prepare(`
      INSERT INTO transactions (session_id, chain, token, amount, recipient, tx_hash, fee, status)
      VALUES (@session_id, @chain, @token, @amount, @recipient, @tx_hash, @fee, @status)
    `)
    .run(tx);
  return result.lastInsertRowid as number;
}

export function updateTxStatus(id: number, status: TxRecord["status"]): void {
  getDb()
    .prepare("UPDATE transactions SET status = ? WHERE id = ?")
    .run(status, id);
}

export function getRecentTxs(sessionId: string, limit = 20): TxRecord[] {
  return getDb()
    .prepare(
      "SELECT * FROM transactions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(sessionId, limit) as TxRecord[];
}

export function getLastTxToRecipient(sessionId: string): TxRecord | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM transactions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(sessionId) as TxRecord | undefined;
}

export function getTxsByRecipient(sessionId: string, recipient: string): TxRecord[] {
  return getDb()
    .prepare(
      "SELECT * FROM transactions WHERE session_id = ? AND recipient = ? ORDER BY created_at DESC LIMIT 10"
    )
    .all(sessionId, recipient) as TxRecord[];
}
