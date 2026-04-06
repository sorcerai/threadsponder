import Database from 'better-sqlite3';

// Inlined so it survives tsc without a separate .sql copy step
const SCHEMA_SQL = `
-- Core account (replaces accounts + clerk_user_id)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired')),
  subscription_ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Threads OAuth credentials (encrypted token at rest)
CREATE TABLE IF NOT EXISTS threads_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_user_id TEXT NOT NULL,
  threads_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_user_id)
);

-- Voice training examples (embedding stored as JSON text)
CREATE TABLE IF NOT EXISTS voice_examples (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',
  embedding TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Voice settings
CREATE TABLE IF NOT EXISTS voice_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  formality INTEGER NOT NULL DEFAULT 5 CHECK (formality BETWEEN 1 AND 10),
  brevity INTEGER NOT NULL DEFAULT 5 CHECK (brevity BETWEEN 1 AND 10),
  aggression INTEGER NOT NULL DEFAULT 5 CHECK (aggression BETWEEN 1 AND 10),
  emoji_usage INTEGER NOT NULL DEFAULT 3 CHECK (emoji_usage BETWEEN 1 AND 10),
  custom_instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Posts being monitored for replies
CREATE TABLE IF NOT EXISTS focused_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  threads_post_id TEXT NOT NULL,
  post_text TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_post_id)
);

-- Scheduled posts queue
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_urls TEXT DEFAULT '[]',
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'failed', 'cancelled')),
  posted_id TEXT,
  error_message TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reply history (deduplication + analytics)
CREATE TABLE IF NOT EXISTS reply_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  focused_post_id TEXT NOT NULL REFERENCES focused_posts(id) ON DELETE CASCADE,
  threads_reply_id TEXT NOT NULL,
  replier_username TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'neutral',
  confidence REAL NOT NULL DEFAULT 0.5,
  our_response TEXT,
  our_reply_id TEXT,
  replied INTEGER NOT NULL DEFAULT 0,
  hostile_words TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_reply_id)
);

-- Blocked users
CREATE TABLE IF NOT EXISTS blocked_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_username)
);

-- Friends (special reply mode: banter/roast)
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'banter' CHECK (mode IN ('banter', 'roast', 'normal')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_username)
);

-- Per-user cooldowns (prevent reply spam to same person)
CREATE TABLE IF NOT EXISTS user_cooldowns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  last_replied_at TEXT NOT NULL,
  UNIQUE(account_id, threads_username)
);

-- Bot loop tracking (detect reply chains that loop)
CREATE TABLE IF NOT EXISTS bot_loop_rates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  UNIQUE(account_id, threads_username)
);

-- Post performance metrics
CREATE TABLE IF NOT EXISTS post_metrics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  focused_post_id TEXT NOT NULL REFERENCES focused_posts(id) ON DELETE CASCADE,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  quotes INTEGER DEFAULT 0,
  reposts INTEGER DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Banned phrases (never say these in responses)
CREATE TABLE IF NOT EXISTS banned_phrases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, phrase)
);

-- Ammunition (pre-written comebacks/responses)
CREATE TABLE IF NOT EXISTS ammunition (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Usage events (lightweight analytics)
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Voice document processing queue (workers poll this)
CREATE TABLE IF NOT EXISTS voice_processing_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_threads_accounts_account ON threads_accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_focused_posts_account ON focused_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_focused_posts_active ON focused_posts(account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_reply_history_post ON reply_history(focused_post_id);
CREATE INDEX IF NOT EXISTS idx_reply_history_account_date ON reply_history(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_voice_examples_account ON voice_examples(account_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_account ON usage_events(account_id, created_at);
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.SQLITE_DB_PATH ?? `${process.cwd()}/threadsponder.db`;

  _db = new Database(dbPath);

  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  _db.exec(SCHEMA_SQL);

  return _db;
}

export function _resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
