-- Ammunition/RAG Knowledge Base
-- "Sniper RAG" system for fact-based dunks and informed replies
-- Uses pgvector (already enabled in 003_voice.sql)

CREATE TABLE IF NOT EXISTS ammunition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Content
  content TEXT NOT NULL,
  title TEXT,  -- Optional title/headline for the fact
  source TEXT,  -- Where this fact came from (URL, document, manual)
  source_type TEXT CHECK (source_type IN ('url', 'document', 'manual', 'api')),

  -- Categorization
  category TEXT CHECK (category IN (
    'legal',          -- Court cases, rulings, laws
    'statistical',    -- Data, studies, numbers
    'technical',      -- Technical facts, how things work
    'historical',     -- Historical events, precedents
    'quotation',      -- Expert quotes
    'definition',     -- Definitions, clarifications
    'general'         -- General facts
  )),
  tags TEXT[] DEFAULT '{}',  -- Flexible tagging

  -- Vector embedding for semantic search (1024-dim matching voice_examples)
  embedding vector(1024),

  -- Metadata
  confidence_score DECIMAL(3,2) DEFAULT 1.00,  -- How confident are we in this fact
  times_used INTEGER DEFAULT 0,  -- Track usage for relevance
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS ammunition_account_id_idx ON ammunition(account_id);
CREATE INDEX IF NOT EXISTS ammunition_category_idx ON ammunition(account_id, category);
CREATE INDEX IF NOT EXISTS ammunition_tags_idx ON ammunition USING GIN(tags);
CREATE INDEX IF NOT EXISTS ammunition_active_idx ON ammunition(account_id, is_active) WHERE is_active = true;

-- HNSW index for fast vector similarity search (same as voice_examples)
CREATE INDEX IF NOT EXISTS ammunition_embedding_idx ON ammunition
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Updated at trigger
CREATE TRIGGER ammunition_updated_at
  BEFORE UPDATE ON ammunition
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE ammunition ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own ammunition" ON ammunition
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own ammunition" ON ammunition
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own ammunition" ON ammunition
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own ammunition" ON ammunition
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Function to search ammunition by embedding similarity (Sniper RAG)
CREATE OR REPLACE FUNCTION search_ammunition(
  p_account_id UUID,
  p_embedding vector(1024),
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  title TEXT,
  source TEXT,
  category TEXT,
  tags TEXT[],
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.content,
    a.title,
    a.source,
    a.category,
    a.tags,
    1 - (a.embedding <=> p_embedding) AS similarity
  FROM ammunition a
  WHERE a.account_id = p_account_id
    AND a.is_active = true
    AND a.embedding IS NOT NULL
    AND (p_category IS NULL OR a.category = p_category)
  ORDER BY a.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$;

-- Function to hybrid search ammunition (BM25 + Vector)
-- Uses ts_rank for keyword relevance combined with vector similarity
CREATE OR REPLACE FUNCTION hybrid_search_ammunition(
  p_account_id UUID,
  p_query TEXT,
  p_embedding vector(1024),
  p_alpha FLOAT DEFAULT 0.7,  -- Weight for vector vs keyword (0.7 = 70% vector)
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  title TEXT,
  source TEXT,
  category TEXT,
  vector_score FLOAT,
  keyword_score FLOAT,
  hybrid_score FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      a.id,
      a.content,
      a.title,
      a.source,
      a.category,
      1 - (a.embedding <=> p_embedding) AS v_score
    FROM ammunition a
    WHERE a.account_id = p_account_id
      AND a.is_active = true
      AND a.embedding IS NOT NULL
    ORDER BY a.embedding <=> p_embedding
    LIMIT p_limit * 3  -- Over-fetch for fusion
  ),
  keyword_results AS (
    SELECT
      a.id,
      ts_rank(to_tsvector('english', a.content), plainto_tsquery('english', p_query)) AS k_score
    FROM ammunition a
    WHERE a.account_id = p_account_id
      AND a.is_active = true
      AND to_tsvector('english', a.content) @@ plainto_tsquery('english', p_query)
  )
  SELECT
    vr.id,
    vr.content,
    vr.title,
    vr.source,
    vr.category,
    vr.v_score AS vector_score,
    COALESCE(kr.k_score, 0)::FLOAT AS keyword_score,
    (p_alpha * vr.v_score + (1 - p_alpha) * COALESCE(kr.k_score, 0))::FLOAT AS hybrid_score
  FROM vector_results vr
  LEFT JOIN keyword_results kr ON vr.id = kr.id
  ORDER BY (p_alpha * vr.v_score + (1 - p_alpha) * COALESCE(kr.k_score, 0)) DESC
  LIMIT p_limit;
END;
$$;

-- Function to increment usage counter when ammunition is used
CREATE OR REPLACE FUNCTION use_ammunition(p_ammo_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE ammunition
  SET times_used = times_used + 1,
      last_used_at = now()
  WHERE id = p_ammo_id;
END;
$$;

-- Add full-text search index for keyword matching
CREATE INDEX IF NOT EXISTS ammunition_content_fts_idx ON ammunition
  USING GIN(to_tsvector('english', content));
