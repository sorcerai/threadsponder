-- Focused posts to monitor for replies
CREATE TABLE IF NOT EXISTS focused_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id UUID NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  post_text TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS focused_posts_account_id_idx ON focused_posts(account_id);
CREATE INDEX IF NOT EXISTS focused_posts_active_idx ON focused_posts(threads_account_id)
  WHERE is_active = true;

-- Updated at trigger
CREATE TRIGGER focused_posts_updated_at
  BEFORE UPDATE ON focused_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Scheduled posts for post scheduler feature
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id UUID NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_urls TEXT[] NOT NULL DEFAULT '{}',
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'failed', 'cancelled')),
  posted_id TEXT,  -- Threads post ID after publishing
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for finding due posts
CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx ON scheduled_posts(scheduled_for)
  WHERE status = 'pending';

-- Index for account lookups
CREATE INDEX IF NOT EXISTS scheduled_posts_account_idx ON scheduled_posts(account_id);

-- Updated at trigger
CREATE TRIGGER scheduled_posts_updated_at
  BEFORE UPDATE ON scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE focused_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for focused_posts
CREATE POLICY "Users can view own focused posts" ON focused_posts
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own focused posts" ON focused_posts
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own focused posts" ON focused_posts
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own focused posts" ON focused_posts
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for scheduled_posts
CREATE POLICY "Users can view own scheduled posts" ON scheduled_posts
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own scheduled posts" ON scheduled_posts
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own scheduled posts" ON scheduled_posts
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own scheduled posts" ON scheduled_posts
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
