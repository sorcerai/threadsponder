-- Ghost Analytics: Metrics Meta doesn't show
-- Tracks post metrics over time for velocity and engagement rate calculations

-- ============================================
-- Post Metrics Snapshots (time-series storage)
-- ============================================
CREATE TABLE IF NOT EXISTS post_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,

  -- Raw metrics from Threads API
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  quotes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,

  -- Calculated metrics
  engagement_rate FLOAT,  -- (likes + replies + quotes) / views
  velocity_score FLOAT,   -- Δviews/Δtime vs baseline (1.0 = average, 2.0 = 2x faster)

  -- Deltas from previous snapshot
  views_delta INTEGER,
  likes_delta INTEGER,
  replies_delta INTEGER,

  -- Metadata
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hours_since_post FLOAT,  -- Time since post was created

  UNIQUE(account_id, post_id, snapshot_at)
);

-- Index for time-series queries
CREATE INDEX IF NOT EXISTS idx_post_metrics_account_time
  ON post_metrics(account_id, snapshot_at DESC);

-- Index for post-specific queries
CREATE INDEX IF NOT EXISTS idx_post_metrics_post
  ON post_metrics(account_id, post_id, snapshot_at DESC);

-- BRIN index for large time-series data (efficient for ordered timestamps)
CREATE INDEX IF NOT EXISTS idx_post_metrics_brin
  ON post_metrics USING BRIN(snapshot_at);

-- ============================================
-- Account Velocity Baseline (rolling averages)
-- ============================================
CREATE TABLE IF NOT EXISTS account_velocity_baseline (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

  -- Velocity baselines (views gained per hour, averaged)
  avg_velocity_1h FLOAT DEFAULT 0,   -- Average views/hour in first hour
  avg_velocity_6h FLOAT DEFAULT 0,   -- Average views/hour in first 6 hours
  avg_velocity_24h FLOAT DEFAULT 0,  -- Average views/hour in first 24 hours

  -- Engagement baseline
  avg_engagement_rate FLOAT DEFAULT 0,

  -- Statistical metadata
  sample_count INTEGER DEFAULT 0,      -- Number of posts used for calculation
  min_velocity_1h FLOAT,
  max_velocity_1h FLOAT,
  stddev_velocity_1h FLOAT,

  -- Timestamps
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Post Performance Summary (latest state per post)
-- ============================================
CREATE TABLE IF NOT EXISTS post_performance (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,

  -- Post metadata
  post_text TEXT,
  posted_at TIMESTAMPTZ,

  -- Latest metrics
  current_views INTEGER DEFAULT 0,
  current_likes INTEGER DEFAULT 0,
  current_replies INTEGER DEFAULT 0,
  current_quotes INTEGER DEFAULT 0,
  current_reposts INTEGER DEFAULT 0,
  current_shares INTEGER DEFAULT 0,

  -- Calculated performance indicators
  engagement_rate FLOAT,
  peak_velocity FLOAT,      -- Highest velocity achieved
  velocity_at_1h FLOAT,     -- Velocity at 1 hour mark
  velocity_at_6h FLOAT,     -- Velocity at 6 hour mark
  velocity_at_24h FLOAT,    -- Velocity at 24 hour mark

  -- Comparison to baseline
  velocity_vs_avg FLOAT,    -- e.g., 2.0 = "2x faster than average"
  engagement_vs_avg FLOAT,  -- e.g., 1.5 = "1.5x better engagement"

  -- Evergreen candidacy (for recycler feature)
  is_evergreen_candidate BOOLEAN DEFAULT FALSE,
  last_recycled_at TIMESTAMPTZ,
  recycle_count INTEGER DEFAULT 0,

  -- Timestamps
  first_snapshot_at TIMESTAMPTZ,
  last_snapshot_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (account_id, post_id)
);

-- Index for finding top performers
CREATE INDEX IF NOT EXISTS idx_post_performance_engagement
  ON post_performance(account_id, engagement_rate DESC NULLS LAST);

-- Index for evergreen candidates
CREATE INDEX IF NOT EXISTS idx_post_performance_evergreen
  ON post_performance(account_id, is_evergreen_candidate, posted_at DESC)
  WHERE is_evergreen_candidate = TRUE;

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE post_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_velocity_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_performance ENABLE ROW LEVEL SECURITY;

-- RLS Policies for post_metrics
CREATE POLICY "post_metrics_select" ON post_metrics
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "post_metrics_insert" ON post_metrics
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "post_metrics_update" ON post_metrics
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for account_velocity_baseline
CREATE POLICY "velocity_baseline_select" ON account_velocity_baseline
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "velocity_baseline_all" ON account_velocity_baseline
  FOR ALL USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

-- RLS Policies for post_performance
CREATE POLICY "post_performance_select" ON post_performance
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "post_performance_all" ON post_performance
  FOR ALL USING (
    account_id IN (
      SELECT id FROM accounts WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- Helper Functions
-- ============================================

-- Calculate engagement rate
CREATE OR REPLACE FUNCTION calculate_engagement_rate(
  p_views INTEGER,
  p_likes INTEGER,
  p_replies INTEGER,
  p_quotes INTEGER
) RETURNS FLOAT AS $$
BEGIN
  IF p_views = 0 THEN
    RETURN 0;
  END IF;
  RETURN (p_likes + p_replies + p_quotes)::FLOAT / p_views::FLOAT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate velocity score (compare to baseline)
CREATE OR REPLACE FUNCTION calculate_velocity_score(
  p_views_delta INTEGER,
  p_hours_delta FLOAT,
  p_baseline_velocity FLOAT
) RETURNS FLOAT AS $$
DECLARE
  actual_velocity FLOAT;
BEGIN
  IF p_hours_delta <= 0 OR p_baseline_velocity <= 0 THEN
    RETURN NULL;
  END IF;

  actual_velocity := p_views_delta::FLOAT / p_hours_delta;
  RETURN actual_velocity / p_baseline_velocity;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update baseline from recent posts
CREATE OR REPLACE FUNCTION update_account_baseline(p_account_id UUID)
RETURNS VOID AS $$
DECLARE
  v_sample_count INTEGER;
  v_avg_velocity_1h FLOAT;
  v_avg_velocity_6h FLOAT;
  v_avg_velocity_24h FLOAT;
  v_avg_engagement FLOAT;
  v_min_velocity FLOAT;
  v_max_velocity FLOAT;
  v_stddev_velocity FLOAT;
BEGIN
  -- Calculate baseline from posts older than 24 hours (settled metrics)
  WITH recent_posts AS (
    SELECT
      post_id,
      velocity_at_1h,
      velocity_at_6h,
      velocity_at_24h,
      engagement_rate
    FROM post_performance
    WHERE account_id = p_account_id
      AND posted_at < NOW() - INTERVAL '24 hours'
      AND velocity_at_1h IS NOT NULL
    ORDER BY posted_at DESC
    LIMIT 50  -- Use last 50 posts for baseline
  )
  SELECT
    COUNT(*),
    AVG(velocity_at_1h),
    AVG(velocity_at_6h),
    AVG(velocity_at_24h),
    AVG(engagement_rate),
    MIN(velocity_at_1h),
    MAX(velocity_at_1h),
    STDDEV(velocity_at_1h)
  INTO
    v_sample_count,
    v_avg_velocity_1h,
    v_avg_velocity_6h,
    v_avg_velocity_24h,
    v_avg_engagement,
    v_min_velocity,
    v_max_velocity,
    v_stddev_velocity
  FROM recent_posts;

  -- Only update if we have enough samples
  IF v_sample_count >= 5 THEN
    INSERT INTO account_velocity_baseline (
      account_id,
      avg_velocity_1h,
      avg_velocity_6h,
      avg_velocity_24h,
      avg_engagement_rate,
      sample_count,
      min_velocity_1h,
      max_velocity_1h,
      stddev_velocity_1h,
      updated_at
    ) VALUES (
      p_account_id,
      COALESCE(v_avg_velocity_1h, 0),
      COALESCE(v_avg_velocity_6h, 0),
      COALESCE(v_avg_velocity_24h, 0),
      COALESCE(v_avg_engagement, 0),
      v_sample_count,
      v_min_velocity,
      v_max_velocity,
      v_stddev_velocity,
      NOW()
    )
    ON CONFLICT (account_id) DO UPDATE SET
      avg_velocity_1h = EXCLUDED.avg_velocity_1h,
      avg_velocity_6h = EXCLUDED.avg_velocity_6h,
      avg_velocity_24h = EXCLUDED.avg_velocity_24h,
      avg_engagement_rate = EXCLUDED.avg_engagement_rate,
      sample_count = EXCLUDED.sample_count,
      min_velocity_1h = EXCLUDED.min_velocity_1h,
      max_velocity_1h = EXCLUDED.max_velocity_1h,
      stddev_velocity_1h = EXCLUDED.stddev_velocity_1h,
      updated_at = NOW();
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE post_metrics IS 'Time-series storage of post metrics snapshots for velocity calculation';
COMMENT ON TABLE account_velocity_baseline IS 'Rolling averages for each account to compare post performance';
COMMENT ON TABLE post_performance IS 'Latest performance summary per post with calculated indicators';
COMMENT ON COLUMN post_performance.velocity_vs_avg IS 'Ratio vs baseline (2.0 = "2x faster than your average")';
COMMENT ON COLUMN post_performance.is_evergreen_candidate IS 'Posts with engagement_rate > 2x avg AND older than 90 days';
