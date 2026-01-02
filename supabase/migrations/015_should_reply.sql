-- Should Reply Evaluator: Blocklist, cooldowns, and reply tracking
-- Ported from eliza-threads should-reply.ts evaluator

-- Blocked users table
CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  reason TEXT,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One block per user per account
  UNIQUE(account_id, username)
);

CREATE INDEX IF NOT EXISTS idx_blocked_account ON blocked_users(account_id);
CREATE INDEX IF NOT EXISTS idx_blocked_username ON blocked_users(account_id, username);

-- Replied comments tracking (prevent double replies)
CREATE TABLE IF NOT EXISTS replied_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reply_id TEXT NOT NULL,
  replied_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One entry per reply per account
  UNIQUE(account_id, reply_id)
);

CREATE INDEX IF NOT EXISTS idx_replied_account ON replied_comments(account_id);
CREATE INDEX IF NOT EXISTS idx_replied_lookup ON replied_comments(account_id, reply_id);
CREATE INDEX IF NOT EXISTS idx_replied_at ON replied_comments(replied_at);

-- User cooldowns
CREATE TABLE IF NOT EXISTS user_cooldowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  last_reply_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One cooldown per user per account
  UNIQUE(account_id, username)
);

CREATE INDEX IF NOT EXISTS idx_cooldowns_lookup ON user_cooldowns(account_id, username);

-- Enable RLS
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE replied_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cooldowns ENABLE ROW LEVEL SECURITY;

-- RLS Policies for blocked_users
CREATE POLICY "Users can view own blocked" ON blocked_users
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own blocked" ON blocked_users
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own blocked" ON blocked_users
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for replied_comments
CREATE POLICY "Users can view own replied" ON replied_comments
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own replied" ON replied_comments
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for user_cooldowns
CREATE POLICY "Users can view own cooldowns" ON user_cooldowns
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can upsert own cooldowns" ON user_cooldowns
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own cooldowns" ON user_cooldowns
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Cleanup function: Remove old replied entries (> 7 days)
CREATE OR REPLACE FUNCTION cleanup_replied_comments()
RETURNS void AS $$
BEGIN
  DELETE FROM replied_comments
  WHERE replied_at < now() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- Cleanup function: Remove old cooldowns (> 1 hour)
CREATE OR REPLACE FUNCTION cleanup_user_cooldowns()
RETURNS void AS $$
BEGIN
  DELETE FROM user_cooldowns
  WHERE last_reply_at < now() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
