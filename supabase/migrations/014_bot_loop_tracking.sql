-- Bot Loop Tracking: 3-layer bot detection state management
-- Ported from eliza-threads bot-loop.ts evaluator

-- Rate tracking: replies per user/thread per hour
CREATE TABLE IF NOT EXISTS bot_loop_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tracking_type TEXT NOT NULL CHECK (tracking_type IN ('user', 'thread')),
  tracking_key TEXT NOT NULL,  -- username or thread_id
  reply_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One entry per reply per tracking key
  UNIQUE(account_id, tracking_type, tracking_key, reply_id)
);

-- Indexes for efficient rate counting
CREATE INDEX IF NOT EXISTS idx_rates_account ON bot_loop_rates(account_id);
CREATE INDEX IF NOT EXISTS idx_rates_lookup ON bot_loop_rates(account_id, tracking_type, tracking_key);
CREATE INDEX IF NOT EXISTS idx_rates_created ON bot_loop_rates(created_at);

-- Conversation depth tracking
CREATE TABLE IF NOT EXISTS bot_loop_depths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  username TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One depth per user per thread per account
  UNIQUE(account_id, thread_id, username)
);

CREATE INDEX IF NOT EXISTS idx_depths_lookup ON bot_loop_depths(account_id, thread_id, username);

-- Output tracking for semantic similarity
CREATE TABLE IF NOT EXISTS bot_loop_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  output_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outputs_thread ON bot_loop_outputs(account_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_outputs_created ON bot_loop_outputs(created_at);

-- Enable RLS
ALTER TABLE bot_loop_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_loop_depths ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_loop_outputs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bot_loop_rates
CREATE POLICY "Users can view own rates" ON bot_loop_rates
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own rates" ON bot_loop_rates
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own rates" ON bot_loop_rates
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for bot_loop_depths
CREATE POLICY "Users can view own depths" ON bot_loop_depths
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own depths" ON bot_loop_depths
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own depths" ON bot_loop_depths
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for bot_loop_outputs
CREATE POLICY "Users can view own outputs" ON bot_loop_outputs
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own outputs" ON bot_loop_outputs
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own outputs" ON bot_loop_outputs
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Cleanup function: Remove old rate entries (> 1 hour)
CREATE OR REPLACE FUNCTION cleanup_bot_loop_rates()
RETURNS void AS $$
BEGIN
  DELETE FROM bot_loop_rates
  WHERE created_at < now() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Cleanup function: Remove old depths (> 24 hours)
CREATE OR REPLACE FUNCTION cleanup_bot_loop_depths()
RETURNS void AS $$
BEGIN
  DELETE FROM bot_loop_depths
  WHERE last_updated < now() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Cleanup function: Remove old outputs (> 7 days)
CREATE OR REPLACE FUNCTION cleanup_bot_loop_outputs()
RETURNS void AS $$
BEGIN
  DELETE FROM bot_loop_outputs
  WHERE created_at < now() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
