-- Core multi-tenancy: accounts table
-- This is the main tenant table, linked to Clerk user IDs

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT UNIQUE NOT NULL,  -- Links to Clerk
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'trial'
    CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired')),
  subscription_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for Clerk lookups
CREATE INDEX IF NOT EXISTS accounts_clerk_user_id_idx ON accounts(clerk_user_id);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own account
CREATE POLICY "Users can view own account" ON accounts
  FOR SELECT USING (clerk_user_id = current_setting('app.clerk_user_id', true));

CREATE POLICY "Users can update own account" ON accounts
  FOR UPDATE USING (clerk_user_id = current_setting('app.clerk_user_id', true));
