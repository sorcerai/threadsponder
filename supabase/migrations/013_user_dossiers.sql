-- User Dossiers: Track user desperation patterns for "Loser Dossier" system
-- Ported from eliza-threads InsecurityProvider

CREATE TABLE IF NOT EXISTS user_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_user_id TEXT NOT NULL,  -- Their Threads username/ID

  -- Desperation metrics
  last_latency_ms INTEGER DEFAULT 0,    -- Speed of their reply (< 60s = JOBLESS)
  last_char_count INTEGER DEFAULT 0,    -- Length of reply (> 200 = YAPPER)
  total_replies INTEGER DEFAULT 0,      -- Total replies to us (5+ = FAN)
  is_double_texting BOOLEAN DEFAULT FALSE,  -- Replied while waiting (DESPERATE)

  -- Derived archetype: DESPERATE > JOBLESS > YAPPER > FAN > NORMIE
  archetype TEXT NOT NULL DEFAULT 'NORMIE'
    CHECK (archetype IN ('DESPERATE', 'JOBLESS', 'YAPPER', 'FAN', 'NORMIE')),

  -- Waiting state for double-text detection
  is_waiting BOOLEAN DEFAULT FALSE,
  waiting_since TIMESTAMPTZ,

  -- Timestamps
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One dossier per user per account
  UNIQUE(account_id, threads_user_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_dossiers_account ON user_dossiers(account_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_user ON user_dossiers(threads_user_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_archetype ON user_dossiers(account_id, archetype);
CREATE INDEX IF NOT EXISTS idx_dossiers_last_seen ON user_dossiers(last_seen DESC);

-- Updated at trigger
CREATE TRIGGER user_dossiers_updated_at
  BEFORE UPDATE ON user_dossiers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE user_dossiers ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Tenant isolation via accounts relationship
CREATE POLICY "Users can view own dossiers" ON user_dossiers
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own dossiers" ON user_dossiers
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own dossiers" ON user_dossiers
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own dossiers" ON user_dossiers
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
