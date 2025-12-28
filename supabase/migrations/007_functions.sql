-- PostgreSQL functions for Threadsponder

-- Function to search voice examples by embedding similarity
CREATE OR REPLACE FUNCTION search_voice_examples(
  p_account_id UUID,
  p_embedding vector(1024),
  p_tone TEXT,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  account_id UUID,
  text TEXT,
  tone TEXT,
  source TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ve.id,
    ve.account_id,
    ve.text,
    ve.tone,
    ve.source,
    1 - (ve.embedding <=> p_embedding) AS similarity
  FROM voice_examples ve
  WHERE ve.account_id = p_account_id
    AND ve.is_active = true
    AND ve.tone = p_tone
    AND ve.embedding IS NOT NULL
  ORDER BY ve.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;

-- Function to get reply analytics for a time period
CREATE OR REPLACE FUNCTION get_reply_analytics(
  p_account_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS TABLE (
  day DATE,
  classification TEXT,
  total_replies BIGINT,
  replies_sent BIGINT,
  avg_processing_time_ms NUMERIC
)
LANGUAGE sql
AS $$
  SELECT
    DATE_TRUNC('day', created_at)::DATE AS day,
    classification,
    COUNT(*) AS total_replies,
    COUNT(*) FILTER (WHERE was_posted) AS replies_sent,
    AVG(processing_time_ms) AS avg_processing_time_ms
  FROM reply_history
  WHERE account_id = p_account_id
    AND created_at >= p_start_date
    AND created_at < p_end_date
  GROUP BY DATE_TRUNC('day', created_at), classification
  ORDER BY day DESC, classification;
$$;

-- Function to get dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_account_id UUID)
RETURNS TABLE (
  total_replies_today BIGINT,
  replies_sent_today BIGINT,
  total_replies_week BIGINT,
  replies_sent_week BIGINT,
  friendly_count BIGINT,
  hostile_count BIGINT,
  neutral_count BIGINT,
  avg_response_time_ms NUMERIC
)
LANGUAGE sql
AS $$
  SELECT
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS total_replies_today,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE AND was_posted) AS replies_sent_today,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS total_replies_week,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days' AND was_posted) AS replies_sent_week,
    COUNT(*) FILTER (WHERE classification = 'friendly') AS friendly_count,
    COUNT(*) FILTER (WHERE classification = 'hostile') AS hostile_count,
    COUNT(*) FILTER (WHERE classification = 'neutral') AS neutral_count,
    AVG(processing_time_ms) AS avg_response_time_ms
  FROM reply_history
  WHERE account_id = p_account_id
    AND created_at >= CURRENT_DATE - INTERVAL '30 days';
$$;

-- Function to check if we've already replied to a thread
CREATE OR REPLACE FUNCTION has_replied_to_thread(
  p_account_id UUID,
  p_original_reply_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  SELECT EXISTS(
    SELECT 1 FROM reply_history
    WHERE account_id = p_account_id
      AND original_reply_id = p_original_reply_id
  );
$$;

-- Trigger to create default voice settings for new accounts
CREATE OR REPLACE FUNCTION create_default_voice_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO voice_settings (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_create_voice_settings
  AFTER INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION create_default_voice_settings();
