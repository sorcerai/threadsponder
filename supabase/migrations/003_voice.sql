-- Voice training system with pgvector for embeddings
-- Uses 1024-dim vectors (matching text-embedding-3-large or similar)

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Voice examples table with embeddings
CREATE TABLE IF NOT EXISTS voice_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('friendly', 'neutral', 'hostile')),
  embedding vector(1024),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'document')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS voice_examples_embedding_idx ON voice_examples
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Index for account + tone lookups
CREATE INDEX IF NOT EXISTS voice_examples_account_tone_idx ON voice_examples(account_id, tone)
  WHERE is_active = true;

-- Voice settings (fine-tuning sliders per account)
CREATE TABLE IF NOT EXISTS voice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE UNIQUE,
  formality DECIMAL(3,2) NOT NULL DEFAULT 0.3 CHECK (formality >= 0 AND formality <= 1),
  brevity DECIMAL(3,2) NOT NULL DEFAULT 0.2 CHECK (brevity >= 0 AND brevity <= 1),
  emoji_usage DECIMAL(3,2) NOT NULL DEFAULT 0.4 CHECK (emoji_usage >= 0 AND emoji_usage <= 1),
  aggression DECIMAL(3,2) NOT NULL DEFAULT 0.5 CHECK (aggression >= 0 AND aggression <= 1),
  never_say TEXT[] NOT NULL DEFAULT '{}',
  always_use TEXT[] NOT NULL DEFAULT '{}',
  signature_phrases TEXT[] NOT NULL DEFAULT '{}',
  response_lengths JSONB NOT NULL DEFAULT '{
    "friendly": {"min": 3, "max": 15},
    "neutral": {"min": 5, "max": 25},
    "hostile": {"min": 2, "max": 10}
  }',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated at trigger for voice_settings
CREATE TRIGGER voice_settings_updated_at
  BEFORE UPDATE ON voice_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Document uploads for voice training
CREATE TABLE IF NOT EXISTS voice_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,  -- Supabase Storage path
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  chunks_processed INTEGER NOT NULL DEFAULT 0,
  examples_created INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated at trigger for voice_documents
CREATE TRIGGER voice_documents_updated_at
  BEFORE UPDATE ON voice_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE voice_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for voice_examples
CREATE POLICY "Users can view own voice examples" ON voice_examples
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own voice examples" ON voice_examples
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own voice examples" ON voice_examples
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own voice examples" ON voice_examples
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for voice_settings
CREATE POLICY "Users can view own voice settings" ON voice_settings
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own voice settings" ON voice_settings
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own voice settings" ON voice_settings
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- RLS Policies for voice_documents
CREATE POLICY "Users can view own voice documents" ON voice_documents
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own voice documents" ON voice_documents
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own voice documents" ON voice_documents
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own voice documents" ON voice_documents
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
