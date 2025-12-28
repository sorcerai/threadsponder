-- Threads API connections (manual token paste initially)
-- Tokens are AES-256 encrypted before storage

CREATE TABLE IF NOT EXISTS threads_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_user_id TEXT NOT NULL,
  threads_username TEXT,
  access_token_encrypted TEXT NOT NULL,  -- AES-256 encrypted
  token_expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, threads_user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS threads_accounts_account_id_idx ON threads_accounts(account_id);
CREATE INDEX IF NOT EXISTS threads_accounts_active_idx ON threads_accounts(account_id) WHERE is_active = true;

-- Updated at trigger
CREATE TRIGGER threads_accounts_updated_at
  BEFORE UPDATE ON threads_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE threads_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own threads accounts" ON threads_accounts
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own threads accounts" ON threads_accounts
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own threads accounts" ON threads_accounts
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own threads accounts" ON threads_accounts
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
