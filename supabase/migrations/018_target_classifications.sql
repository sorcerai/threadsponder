-- Add target classifications to focused posts
-- Allows per-post targeting of hostile, neutral, and/or friendly replies

ALTER TABLE focused_posts
ADD COLUMN IF NOT EXISTS target_classifications TEXT[] NOT NULL DEFAULT ARRAY['hostile', 'friendly', 'neutral'];

-- Add index for filtering by target classification
CREATE INDEX IF NOT EXISTS focused_posts_target_idx
ON focused_posts USING GIN (target_classifications);

-- Comment for documentation
COMMENT ON COLUMN focused_posts.target_classifications IS
'Array of classification types to respond to: hostile, friendly, neutral. Empty = respond to all.';
