// SQLite uses idempotent startup migrations, inlined to survive tsc (see sqlite.ts).
export const HUMAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pending_inference (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  kind TEXT NOT NULL CHECK (kind IN ('classify', 'respond')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'expired')),
  answer TEXT CHECK (answer IS NULL OR json_valid(answer)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inference_pending ON pending_inference(status, created_at);CREATE TABLE IF NOT EXISTS automation_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  require_approval INTEGER NOT NULL DEFAULT 1 CHECK (require_approval IN (0, 1)),
  discovery_enabled INTEGER NOT NULL DEFAULT 0 CHECK (discovery_enabled IN (0, 1)),
  discovery_queries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discovery_queries))
);
CREATE TABLE IF NOT EXISTS pending_replies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  threads_reply_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  response TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_reply_id)
);
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  threads_post_id TEXT NOT NULL,
  query TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(threads_account_id, threads_post_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_replies_status ON pending_replies(status, created_at);
CREATE INDEX IF NOT EXISTS idx_discovery_status ON discovery_candidates(status, created_at);
`;