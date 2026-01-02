-- Fine-tuning and Auto-Eval Schema

-- 1. Add columns to reply_history
ALTER TABLE reply_history
ADD COLUMN IF NOT EXISTS pattern TEXT,
ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating IN (1, -1)),
ADD COLUMN IF NOT EXISTS auto_eval_scores JSONB,
ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_manual_eval BOOLEAN DEFAULT false;

-- Index for pattern analytics
CREATE INDEX IF NOT EXISTS reply_history_pattern_idx ON reply_history(account_id, pattern);
CREATE INDEX IF NOT EXISTS reply_history_rating_idx ON reply_history(account_id, rating);

-- 2. Banned Phrases Table
CREATE TABLE IF NOT EXISTS banned_phrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  reason TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS banned_phrases_account_id_idx ON banned_phrases(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS banned_phrases_unique_phrase_idx ON banned_phrases(account_id, phrase);

-- RLS for banned_phrases
ALTER TABLE banned_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own banned phrases" ON banned_phrases
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own banned phrases" ON banned_phrases
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own banned phrases" ON banned_phrases
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- 3. Pattern Stats View (Dynamic aggregation)
CREATE OR REPLACE VIEW pattern_stats AS
SELECT
  account_id,
  pattern,
  COUNT(*) FILTER (WHERE rating = 1) AS positive,
  COUNT(*) FILTER (WHERE rating = -1) AS negative,
  COUNT(*) FILTER (WHERE rating IS NOT NULL) AS total,
  CASE
    WHEN COUNT(*) FILTER (WHERE rating IS NOT NULL) > 0 THEN
      COUNT(*) FILTER (WHERE rating = 1)::FLOAT / COUNT(*) FILTER (WHERE rating IS NOT NULL)::FLOAT
    ELSE 0.5
  END AS score
FROM reply_history
WHERE pattern IS NOT NULL
GROUP BY account_id, pattern;
