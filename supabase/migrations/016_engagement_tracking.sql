-- Engagement Tracking: Reply effectiveness metrics for learning
-- Ported from eliza-threads engagement-tracker.ts evaluator

-- Individual reply metrics
CREATE TABLE IF NOT EXISTS engagement_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reply_id TEXT NOT NULL,
  effort_ratio NUMERIC(10, 2) NOT NULL,  -- their words / our words
  our_word_count INTEGER NOT NULL,
  their_word_count INTEGER NOT NULL,
  classification TEXT NOT NULL,
  pattern_used TEXT,  -- which response pattern was detected
  hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One metric per reply per account
  UNIQUE(account_id, reply_id)
);

CREATE INDEX IF NOT EXISTS idx_metrics_account ON engagement_metrics(account_id);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON engagement_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_metrics_pattern ON engagement_metrics(account_id, pattern_used);
CREATE INDEX IF NOT EXISTS idx_metrics_classification ON engagement_metrics(account_id, classification);
CREATE INDEX IF NOT EXISTS idx_metrics_hour ON engagement_metrics(account_id, hour_of_day);

-- Aggregate pattern usage (for fast statistics)
CREATE TABLE IF NOT EXISTS engagement_pattern_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pattern_name TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  total_effort_ratio NUMERIC(10, 2) NOT NULL DEFAULT 0,  -- sum for averaging
  last_used TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_pattern_stats_account ON engagement_pattern_stats(account_id);

-- Aggregate classification stats
CREATE TABLE IF NOT EXISTS engagement_classification_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  classification TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  total_effort_ratio NUMERIC(10, 2) NOT NULL DEFAULT 0,
  last_used TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(account_id, classification)
);

CREATE INDEX IF NOT EXISTS idx_class_stats_account ON engagement_classification_stats(account_id);

-- Aggregate hourly stats
CREATE TABLE IF NOT EXISTS engagement_hourly_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  reply_count INTEGER NOT NULL DEFAULT 0,
  total_effort_ratio NUMERIC(10, 2) NOT NULL DEFAULT 0,

  UNIQUE(account_id, hour_of_day)
);

CREATE INDEX IF NOT EXISTS idx_hourly_stats_account ON engagement_hourly_stats(account_id);

-- Enable RLS
ALTER TABLE engagement_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_pattern_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_classification_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_hourly_stats ENABLE ROW LEVEL SECURITY;

-- RLS Policies for engagement_metrics
CREATE POLICY "Users can view own metrics" ON engagement_metrics
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own metrics" ON engagement_metrics
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for engagement_pattern_stats
CREATE POLICY "Users can view own pattern stats" ON engagement_pattern_stats
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own pattern stats" ON engagement_pattern_stats
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own pattern stats" ON engagement_pattern_stats
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for engagement_classification_stats
CREATE POLICY "Users can view own class stats" ON engagement_classification_stats
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own class stats" ON engagement_classification_stats
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own class stats" ON engagement_classification_stats
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for engagement_hourly_stats
CREATE POLICY "Users can view own hourly stats" ON engagement_hourly_stats
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own hourly stats" ON engagement_hourly_stats
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own hourly stats" ON engagement_hourly_stats
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Cleanup function: Remove old metrics (> 30 days)
CREATE OR REPLACE FUNCTION cleanup_engagement_metrics()
RETURNS void AS $$
BEGIN
  DELETE FROM engagement_metrics
  WHERE created_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
