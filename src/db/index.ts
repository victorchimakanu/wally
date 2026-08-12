import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env["WALLY_DB_PATH"] ?? path.join(__dirname, "..", "..", "wally.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  const schema = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  _db.exec(schema);

  // Defensive migration for databases created before the owner column existed.
  const cols = _db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "owner")) {
    _db.exec("ALTER TABLE sessions ADD COLUMN owner TEXT");
  }

  return _db;
}
