-- Friends list per account
-- Friends get special treatment (banter mode vs roast mode)

CREATE TABLE IF NOT EXISTS friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'banter' CHECK (mode IN ('banter', 'roast')),
  notes TEXT,  -- Optional notes about this friend
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, username)
);

-- Indexes
CREATE INDEX IF NOT EXISTS friends_account_id_idx ON friends(account_id);
CREATE INDEX IF NOT EXISTS friends_username_idx ON friends(account_id, username);

-- Updated at trigger
CREATE TRIGGER friends_updated_at
  BEFORE UPDATE ON friends
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own friends" ON friends
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own friends" ON friends
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own friends" ON friends
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own friends" ON friends
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
