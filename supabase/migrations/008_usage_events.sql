-- Usage Events for billing, monitoring, and daily reports
-- Tracks all API calls, token usage, and costs per account

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Event categorization
  event_type TEXT NOT NULL CHECK (event_type IN (
    'reply_generated',      -- AI generated a reply
    'reply_posted',         -- Reply actually posted to Threads
    'classification',       -- Comment classified
    'embedding_generated',  -- Embedding created
    'ammo_search',          -- RAG ammunition search
    'voice_search',         -- Voice example search
    'post_created',         -- New post created
    'api_call'              -- Generic API call
  )),

  -- Token tracking (for LLM calls)
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,

  -- Model tracking
  model_used TEXT,
  provider TEXT CHECK (provider IN ('openrouter', 'google', 'anthropic', 'openai', 'local')),

  -- Cost tracking (in millicents for precision, 1 cent = 1000 millicents)
  cost_millicents INTEGER DEFAULT 0,

  -- Processing metrics
  latency_ms INTEGER,

  -- Metadata (flexible JSON for event-specific data)
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS usage_events_account_id_idx ON usage_events(account_id);
CREATE INDEX IF NOT EXISTS usage_events_created_at_idx ON usage_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_type_idx ON usage_events(account_id, event_type);
-- Day index removed: created_at index handles date-based queries with range scans

-- Enable RLS
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own usage events" ON usage_events
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own usage events" ON usage_events
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Daily usage summary view
CREATE OR REPLACE VIEW daily_usage_summary AS
SELECT
  account_id,
  DATE_TRUNC('day', created_at)::DATE AS day,
  COUNT(*) AS total_events,
  COUNT(*) FILTER (WHERE event_type = 'reply_generated') AS replies_generated,
  COUNT(*) FILTER (WHERE event_type = 'reply_posted') AS replies_posted,
  COUNT(*) FILTER (WHERE event_type = 'classification') AS classifications,
  COUNT(*) FILTER (WHERE event_type = 'ammo_search') AS ammo_searches,
  SUM(COALESCE(total_tokens, 0)) AS total_tokens,
  SUM(COALESCE(cost_millicents, 0)) AS total_cost_millicents,
  AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms
FROM usage_events
GROUP BY account_id, DATE_TRUNC('day', created_at);

-- Function to get usage stats for billing period
CREATE OR REPLACE FUNCTION get_usage_for_period(
  p_account_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  event_type TEXT,
  event_count BIGINT,
  total_tokens BIGINT,
  total_cost_millicents BIGINT,
  avg_latency_ms NUMERIC
)
LANGUAGE sql
AS $$
  SELECT
    event_type,
    COUNT(*) AS event_count,
    SUM(COALESCE(total_tokens, 0)) AS total_tokens,
    SUM(COALESCE(cost_millicents, 0)) AS total_cost_millicents,
    AVG(latency_ms) AS avg_latency_ms
  FROM usage_events
  WHERE account_id = p_account_id
    AND created_at >= p_start_date
    AND created_at < p_end_date
  GROUP BY event_type
  ORDER BY event_count DESC;
$$;

-- Function to check if account is within usage limits
-- NOTE: For full limit checking with tier awareness, use can_perform_action() from 011_subscription_tiers.sql
CREATE OR REPLACE FUNCTION check_usage_limits(
  p_account_id UUID,
  p_event_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_daily_count INTEGER;
  v_daily_limit INTEGER;
BEGIN
  -- Get today's count for this event type
  SELECT COUNT(*) INTO v_daily_count
  FROM usage_events
  WHERE account_id = p_account_id
    AND event_type = p_event_type
    AND created_at >= CURRENT_DATE;

  -- Daily limits by event type (all duration-based tiers have same daily limits)
  -- Full tier-based limits enforced by can_perform_action() in 011_subscription_tiers.sql
  v_daily_limit := CASE p_event_type
    WHEN 'reply_generated' THEN 500
    WHEN 'classification' THEN 1000
    WHEN 'ammo_search' THEN 200
    WHEN 'voice_search' THEN 200
    WHEN 'post_created' THEN 50
    ELSE 500  -- Default fallback
  END;

  RETURN v_daily_count < v_daily_limit;
END;
$$;

-- Function to log a usage event (convenience wrapper)
CREATE OR REPLACE FUNCTION log_usage_event(
  p_account_id UUID,
  p_event_type TEXT,
  p_input_tokens INTEGER DEFAULT NULL,
  p_output_tokens INTEGER DEFAULT NULL,
  p_model_used TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_cost_millicents INTEGER DEFAULT 0,
  p_latency_ms INTEGER DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO usage_events (
    account_id, event_type, input_tokens, output_tokens, total_tokens,
    model_used, provider, cost_millicents, latency_ms, metadata
  ) VALUES (
    p_account_id, p_event_type, p_input_tokens, p_output_tokens,
    COALESCE(p_input_tokens, 0) + COALESCE(p_output_tokens, 0),
    p_model_used, p_provider, p_cost_millicents, p_latency_ms, p_metadata
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;
