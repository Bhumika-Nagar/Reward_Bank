import Database from "better-sqlite3";

const databaseFile =
  process.env.NODE_ENV === "test" || process.env.VITEST
    ? "rewardbank_test.db"
    : "rewardbank.db";

const db = new Database(databaseFile);

db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS parents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    parent_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    debt INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (parent_id) REFERENCES parents(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    title TEXT NOT NULL,
    reward INTEGER NOT NULL CHECK (reward > 0),
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    approved_at TEXT,

    FOREIGN KEY (child_id) REFERENCES children(id)
  );

  CREATE TABLE IF NOT EXISTS usage_sessions (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    received_at TEXT NOT NULL,
    covered_minutes INTEGER NOT NULL DEFAULT 0,
    rejected_minutes INTEGER NOT NULL DEFAULT 0,
    remaining_balance INTEGER NOT NULL DEFAULT 0,
    cutoff_time TEXT,

    FOREIGN KEY (child_id) REFERENCES children(id)
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    child_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    debt_change INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    balance_after INTEGER NOT NULL,

    FOREIGN KEY (child_id) REFERENCES children(id)
  );
`);

const usageColumns = db
  .prepare("PRAGMA table_info(usage_sessions)")
  .all() as { name: string }[];

if (!usageColumns.some((column) => column.name === "remaining_balance")) {
  db.exec("ALTER TABLE usage_sessions ADD COLUMN remaining_balance INTEGER");
}

const ledgerColumns = db
  .prepare("PRAGMA table_info(ledger_entries)")
  .all() as { name: string }[];

if (!ledgerColumns.some((column) => column.name === "debt_change")) {
  db.exec("ALTER TABLE ledger_entries ADD COLUMN debt_change INTEGER NOT NULL DEFAULT 0");
}

db.exec(`
  UPDATE usage_sessions
  SET remaining_balance = COALESCE(
    (
      SELECT ledger_entries.balance_after
      FROM ledger_entries
      WHERE ledger_entries.reference_id = usage_sessions.id
        AND ledger_entries.child_id = usage_sessions.child_id
      ORDER BY ledger_entries.rowid DESC
      LIMIT 1
    ),
    0
  )
  WHERE remaining_balance IS NULL;
`);

export default db;
