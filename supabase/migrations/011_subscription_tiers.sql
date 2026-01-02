-- Subscription Tiers - Duration-Based Pricing
-- All tiers get full features, differentiated by billing period
-- Daily: $1.99 | Weekly: $9.99 | Monthly: $24.99

CREATE TABLE IF NOT EXISTS subscription_tiers (
  id TEXT PRIMARY KEY,  -- 'daily', 'weekly', 'monthly'
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,

  -- Duration in days
  duration_days INTEGER NOT NULL,

  -- Pricing (stored in cents)
  price_cents INTEGER NOT NULL,

  -- Daily Limits (same for all tiers - full access)
  daily_replies INTEGER NOT NULL DEFAULT 500,
  daily_classifications INTEGER NOT NULL DEFAULT 1000,
  daily_ammo_searches INTEGER NOT NULL DEFAULT 200,
  daily_voice_searches INTEGER NOT NULL DEFAULT 200,
  daily_posts INTEGER NOT NULL DEFAULT 50,

  -- Period Limits (scaled by duration)
  tokens_per_period INTEGER NOT NULL DEFAULT 1000000,
  embeddings_per_period INTEGER NOT NULL DEFAULT 5000,

  -- Features (all tiers get full access)
  features JSONB NOT NULL DEFAULT '{
    "customCharacters": true,
    "ammunitionRAG": true,
    "voiceTraining": true,
    "prioritySupport": true,
    "apiAccess": true,
    "webhooks": true,
    "maxAccounts": 5,
    "maxFocusedPosts": 20,
    "maxFriends": 100,
    "retentionDays": 90
  }',

  -- Display
  badge_color TEXT DEFAULT 'orange',
  is_popular BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert duration-based tiers
INSERT INTO subscription_tiers (
  id, name, display_name, duration_days, price_cents,
  daily_replies, daily_classifications, daily_ammo_searches, daily_voice_searches, daily_posts,
  tokens_per_period, embeddings_per_period,
  features, badge_color, is_popular, sort_order
) VALUES
  (
    'daily', 'daily', 'Daily Pass',
    1, 199,  -- $1.99/day
    500, 1000, 200, 200, 50,
    100000, 500,  -- Scaled for 1 day
    '{
      "customCharacters": true,
      "ammunitionRAG": true,
      "voiceTraining": true,
      "prioritySupport": true,
      "apiAccess": true,
      "webhooks": true,
      "maxAccounts": 5,
      "maxFocusedPosts": 20,
      "maxFriends": 100,
      "retentionDays": 90
    }',
    'blue', false, 1
  ),
  (
    'weekly', 'weekly', 'Weekly Pass',
    7, 999,  -- $9.99/week
    500, 1000, 200, 200, 50,
    700000, 3500,  -- Scaled for 7 days
    '{
      "customCharacters": true,
      "ammunitionRAG": true,
      "voiceTraining": true,
      "prioritySupport": true,
      "apiAccess": true,
      "webhooks": true,
      "maxAccounts": 5,
      "maxFocusedPosts": 20,
      "maxFriends": 100,
      "retentionDays": 90
    }',
    'orange', true, 2
  ),
  (
    'monthly', 'monthly', 'Monthly Pass',
    30, 2499,  -- $24.99/month
    500, 1000, 200, 200, 50,
    3000000, 15000,  -- Scaled for 30 days
    '{
      "customCharacters": true,
      "ammunitionRAG": true,
      "voiceTraining": true,
      "prioritySupport": true,
      "apiAccess": true,
      "webhooks": true,
      "maxAccounts": 5,
      "maxFocusedPosts": 20,
      "maxFriends": 100,
      "retentionDays": 90
    }',
    'purple', false, 3
  )
ON CONFLICT (id) DO UPDATE SET
  price_cents = EXCLUDED.price_cents,
  duration_days = EXCLUDED.duration_days,
  daily_replies = EXCLUDED.daily_replies,
  daily_classifications = EXCLUDED.daily_classifications,
  daily_ammo_searches = EXCLUDED.daily_ammo_searches,
  daily_voice_searches = EXCLUDED.daily_voice_searches,
  daily_posts = EXCLUDED.daily_posts,
  tokens_per_period = EXCLUDED.tokens_per_period,
  embeddings_per_period = EXCLUDED.embeddings_per_period,
  features = EXCLUDED.features,
  updated_at = now();

-- Updated at trigger
CREATE TRIGGER subscription_tiers_updated_at
  BEFORE UPDATE ON subscription_tiers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Usage tracking per billing period
CREATE TABLE IF NOT EXISTS usage_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Period boundaries (based on tier duration)
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  tier_id TEXT REFERENCES subscription_tiers(id),

  -- Aggregated usage for the period
  total_replies INTEGER DEFAULT 0,
  total_classifications INTEGER DEFAULT 0,
  total_ammo_searches INTEGER DEFAULT 0,
  total_voice_searches INTEGER DEFAULT 0,
  total_posts INTEGER DEFAULT 0,
  total_tokens BIGINT DEFAULT 0,
  total_embeddings INTEGER DEFAULT 0,
  total_cost_millicents BIGINT DEFAULT 0,

  -- Status
  is_current BOOLEAN DEFAULT true,
  is_paid BOOLEAN DEFAULT false,
  finalized_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT usage_periods_dates_check CHECK (period_end > period_start)
);

-- Only one current period per account
CREATE UNIQUE INDEX IF NOT EXISTS usage_periods_current_idx
  ON usage_periods(account_id) WHERE is_current = true;

CREATE INDEX IF NOT EXISTS usage_periods_account_id_idx ON usage_periods(account_id);
CREATE INDEX IF NOT EXISTS usage_periods_dates_idx ON usage_periods(account_id, period_start, period_end);

-- Updated at trigger
CREATE TRIGGER usage_periods_updated_at
  BEFORE UPDATE ON usage_periods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE usage_periods ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own usage periods" ON usage_periods
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Function to get current usage period (creates if needed, uses tier duration)
CREATE OR REPLACE FUNCTION get_or_create_usage_period(p_account_id UUID)
RETURNS usage_periods
LANGUAGE plpgsql
AS $$
DECLARE
  v_period usage_periods;
  v_now TIMESTAMPTZ := now();
  v_period_start TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_tier_id TEXT;
  v_duration_days INTEGER;
BEGIN
  -- Try to get existing current period
  SELECT * INTO v_period
  FROM usage_periods
  WHERE account_id = p_account_id AND is_current = true;

  IF FOUND THEN
    -- Check if period has expired
    IF v_period.period_end <= v_now THEN
      -- Finalize old period
      UPDATE usage_periods
      SET is_current = false, finalized_at = v_now
      WHERE id = v_period.id;

      -- Create new period
      v_period := NULL;
    ELSE
      RETURN v_period;
    END IF;
  END IF;

  -- Get account's tier and duration
  SELECT subscription_status INTO v_tier_id
  FROM accounts WHERE id = p_account_id;

  IF v_tier_id IS NULL THEN
    v_tier_id := 'daily';  -- Default to daily
  END IF;

  SELECT duration_days INTO v_duration_days
  FROM subscription_tiers WHERE id = v_tier_id;

  IF v_duration_days IS NULL THEN
    v_duration_days := 1;  -- Default to 1 day
  END IF;

  -- Create new period based on tier duration
  v_period_start := v_now;
  v_period_end := v_period_start + (v_duration_days || ' days')::INTERVAL;

  INSERT INTO usage_periods (account_id, period_start, period_end, tier_id)
  VALUES (p_account_id, v_period_start, v_period_end, v_tier_id)
  RETURNING * INTO v_period;

  RETURN v_period;
END;
$$;

-- Function to check if account can perform action (respects limits)
CREATE OR REPLACE FUNCTION can_perform_action(
  p_account_id UUID,
  p_action TEXT  -- 'reply', 'classification', 'ammo_search', 'voice_search', 'post', 'token', 'embedding'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_account accounts%ROWTYPE;
  v_tier subscription_tiers%ROWTYPE;
  v_period usage_periods;
  v_daily_count INTEGER;
  v_daily_limit INTEGER;
  v_period_count BIGINT;
  v_period_limit BIGINT;
  v_can_proceed BOOLEAN := true;
  v_reason TEXT := NULL;
BEGIN
  -- Get account and tier
  SELECT * INTO v_account FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Account not found');
  END IF;

  SELECT * INTO v_tier FROM subscription_tiers WHERE id = COALESCE(v_account.subscription_status, 'daily');
  IF NOT FOUND THEN
    SELECT * INTO v_tier FROM subscription_tiers WHERE id = 'daily';
  END IF;

  -- Get or create usage period
  v_period := get_or_create_usage_period(p_account_id);

  -- Get today's count for this action type
  SELECT COUNT(*) INTO v_daily_count
  FROM usage_events
  WHERE account_id = p_account_id
    AND event_type = p_action || '_generated'
    AND created_at >= CURRENT_DATE;

  -- Check daily limits
  CASE p_action
    WHEN 'reply' THEN
      v_daily_limit := v_tier.daily_replies;
      v_period_count := v_period.total_replies;
    WHEN 'classification' THEN
      v_daily_limit := v_tier.daily_classifications;
      v_period_count := v_period.total_classifications;
    WHEN 'ammo_search' THEN
      v_daily_limit := v_tier.daily_ammo_searches;
      v_period_count := v_period.total_ammo_searches;
    WHEN 'voice_search' THEN
      v_daily_limit := v_tier.daily_voice_searches;
      v_period_count := v_period.total_voice_searches;
    WHEN 'post' THEN
      v_daily_limit := v_tier.daily_posts;
      v_period_count := v_period.total_posts;
    WHEN 'token' THEN
      v_daily_limit := NULL;
      v_period_count := v_period.total_tokens;
      v_period_limit := v_tier.tokens_per_period;
    WHEN 'embedding' THEN
      v_daily_limit := NULL;
      v_period_count := v_period.total_embeddings;
      v_period_limit := v_tier.embeddings_per_period;
    ELSE
      RETURN jsonb_build_object('allowed', false, 'reason', 'Unknown action type');
  END CASE;

  -- Check daily limit
  IF v_daily_limit IS NOT NULL AND v_daily_count >= v_daily_limit THEN
    v_can_proceed := false;
    v_reason := format('Daily %s limit reached (%s/%s)', p_action, v_daily_count, v_daily_limit);
  END IF;

  -- Check period limit (for tokens/embeddings)
  IF v_can_proceed AND v_period_limit IS NOT NULL AND v_period_count >= v_period_limit THEN
    v_can_proceed := false;
    v_reason := format('Period %s limit reached (%s/%s)', p_action, v_period_count, v_period_limit);
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_can_proceed,
    'reason', v_reason,
    'daily_used', v_daily_count,
    'daily_limit', v_daily_limit,
    'period_used', v_period_count,
    'period_limit', v_period_limit,
    'tier', v_tier.id,
    'period_ends', v_period.period_end
  );
END;
$$;

-- Function to increment usage after action completes
CREATE OR REPLACE FUNCTION increment_usage(
  p_account_id UUID,
  p_action TEXT,
  p_tokens INTEGER DEFAULT 0,
  p_cost_millicents INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_period usage_periods;
BEGIN
  -- Get or create current period
  v_period := get_or_create_usage_period(p_account_id);

  -- Update period aggregates
  UPDATE usage_periods
  SET
    total_replies = total_replies + CASE WHEN p_action = 'reply' THEN 1 ELSE 0 END,
    total_classifications = total_classifications + CASE WHEN p_action = 'classification' THEN 1 ELSE 0 END,
    total_ammo_searches = total_ammo_searches + CASE WHEN p_action = 'ammo_search' THEN 1 ELSE 0 END,
    total_voice_searches = total_voice_searches + CASE WHEN p_action = 'voice_search' THEN 1 ELSE 0 END,
    total_posts = total_posts + CASE WHEN p_action = 'post' THEN 1 ELSE 0 END,
    total_tokens = total_tokens + p_tokens,
    total_embeddings = total_embeddings + CASE WHEN p_action = 'embedding' THEN 1 ELSE 0 END,
    total_cost_millicents = total_cost_millicents + p_cost_millicents,
    updated_at = now()
  WHERE id = v_period.id;
END;
$$;

-- Function to check feature access (all tiers have full access)
CREATE OR REPLACE FUNCTION has_feature(p_account_id UUID, p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier_id TEXT;
  v_features JSONB;
BEGIN
  SELECT subscription_status INTO v_tier_id
  FROM accounts WHERE id = p_account_id;

  IF v_tier_id IS NULL THEN
    v_tier_id := 'daily';
  END IF;

  SELECT features INTO v_features
  FROM subscription_tiers WHERE id = v_tier_id;

  RETURN COALESCE((v_features->>p_feature)::BOOLEAN, true);  -- Default to true (full access)
END;
$$;

-- Function to get feature limit
CREATE OR REPLACE FUNCTION get_feature_limit(p_account_id UUID, p_feature TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tier_id TEXT;
  v_features JSONB;
BEGIN
  SELECT subscription_status INTO v_tier_id
  FROM accounts WHERE id = p_account_id;

  IF v_tier_id IS NULL THEN
    v_tier_id := 'daily';
  END IF;

  SELECT features INTO v_features
  FROM subscription_tiers WHERE id = v_tier_id;

  RETURN COALESCE((v_features->>p_feature)::INTEGER, 100);  -- Generous default
END;
$$;

-- View for account usage dashboard
CREATE OR REPLACE VIEW account_usage_dashboard AS
SELECT
  a.id AS account_id,
  a.subscription_status AS tier,
  t.display_name AS tier_name,
  t.duration_days,
  t.price_cents,

  -- Current period
  p.period_start,
  p.period_end,

  -- Daily usage (today)
  COALESCE(d.replies_today, 0) AS replies_today,
  t.daily_replies AS daily_replies_limit,
  COALESCE(d.classifications_today, 0) AS classifications_today,
  t.daily_classifications AS daily_classifications_limit,

  -- Period usage
  p.total_tokens AS tokens_used,
  t.tokens_per_period AS tokens_limit,
  p.total_embeddings AS embeddings_used,
  t.embeddings_per_period AS embeddings_limit,

  -- Cost
  p.total_cost_millicents,

  -- Features
  t.features
FROM accounts a
LEFT JOIN subscription_tiers t ON t.id = COALESCE(a.subscription_status, 'daily')
LEFT JOIN usage_periods p ON p.account_id = a.id AND p.is_current = true
LEFT JOIN (
  SELECT
    account_id,
    COUNT(*) FILTER (WHERE event_type = 'reply_generated') AS replies_today,
    COUNT(*) FILTER (WHERE event_type = 'classification') AS classifications_today
  FROM usage_events
  WHERE created_at >= CURRENT_DATE
  GROUP BY account_id
) d ON d.account_id = a.id;
