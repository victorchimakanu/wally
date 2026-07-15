PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Sessions table. One row per browser tab.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen   INTEGER NOT NULL DEFAULT (unixepoch()),
  history     TEXT NOT NULL DEFAULT '[]'  -- JSON array of {role, content} messages
);

-- Transaction history. One row per completed on-chain operation.
CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chain       TEXT NOT NULL,
  token       TEXT NOT NULL,
  amount      TEXT NOT NULL,  -- stored as string to avoid float precision loss
  recipient   TEXT NOT NULL,
  tx_hash     TEXT NOT NULL,
  fee         TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','failed')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tx_session    ON transactions (session_id);
CREATE INDEX IF NOT EXISTS idx_tx_chain      ON transactions (chain);
CREATE INDEX IF NOT EXISTS idx_tx_recipient  ON transactions (recipient);
CREATE INDEX IF NOT EXISTS idx_tx_created    ON transactions (created_at DESC);
