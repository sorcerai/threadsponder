-- Reply history for analytics and tracking

CREATE TABLE IF NOT EXISTS reply_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id UUID REFERENCES threads_accounts(id) ON DELETE SET NULL,

  -- Original reply info
  original_reply_id TEXT NOT NULL,
  original_username TEXT,
  original_text TEXT,
  parent_post_id TEXT,

  -- Classification
  classification TEXT CHECK (classification IN ('friendly', 'neutral', 'hostile', 'skip')),
  classification_confidence DECIMAL(3,2),

  -- Our response
  our_response TEXT,
  our_response_id TEXT,  -- Threads ID of our reply

  -- Status
  was_posted BOOLEAN NOT NULL DEFAULT false,
  posted_at TIMESTAMPTZ,
  skip_reason TEXT,  -- Why we didn't respond (if applicable)

  -- Metadata
  processing_time_ms INTEGER,
  model_used TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS reply_history_account_id_idx ON reply_history(account_id);
CREATE INDEX IF NOT EXISTS reply_history_created_at_idx ON reply_history(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reply_history_classification_idx ON reply_history(account_id, classification);
CREATE INDEX IF NOT EXISTS reply_history_original_reply_idx ON reply_history(original_reply_id);

-- Prevent duplicate processing
CREATE UNIQUE INDEX IF NOT EXISTS reply_history_unique_reply_idx ON reply_history(account_id, original_reply_id);

-- Enable RLS
ALTER TABLE reply_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own reply history" ON reply_history
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own reply history" ON reply_history
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Analytics view for dashboard
CREATE OR REPLACE VIEW reply_analytics AS
SELECT
  account_id,
  DATE_TRUNC('day', created_at) AS day,
  classification,
  COUNT(*) AS total_replies,
  COUNT(*) FILTER (WHERE was_posted) AS replies_sent,
  AVG(processing_time_ms) AS avg_processing_time_ms
FROM reply_history
GROUP BY account_id, DATE_TRUNC('day', created_at), classification;
