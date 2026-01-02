-- Character/Archetype Configuration
-- Stores AI agent personality, archetypes, and behavioral settings
-- Matches eliza-threads ThreadfireCharacter format for feature parity

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,
  adjectives TEXT[] DEFAULT '{}',  -- Personality adjectives ["dismissive", "witty", "unbothered"]

  -- Archetype (pre-built personality template)
  archetype TEXT CHECK (archetype IN (
    'savage',    -- Brutal honesty, zero chill
    'hype',      -- Enthusiastic, supportive, positive
    'chill',     -- Laid-back, unbothered, relaxed
    'chaotic',   -- Unpredictable, wild, chaotic energy
    'graceful',  -- Elegant, composed, sophisticated
    'custom'     -- User-defined personality
  )),

  -- Style guidelines (stored as arrays matching eliza format)
  style_all TEXT[] DEFAULT '{}',       -- General style rules
  style_hostile TEXT[] DEFAULT '{}',   -- How to respond to hostile comments
  style_friendly TEXT[] DEFAULT '{}',  -- How to respond to friendly comments
  style_neutral TEXT[] DEFAULT '{}',   -- How to respond to neutral comments

  -- Topics and knowledge
  topics TEXT[] DEFAULT '{}',          -- Topics the character knows about
  knowledge TEXT[] DEFAULT '{}',       -- Specific knowledge/facts

  -- Bio variations (for variety in responses)
  bio TEXT[] DEFAULT '{}',

  -- Settings (JSONB for flexibility, matches ThreadfireCharacter.settings)
  settings JSONB DEFAULT '{
    "effortAsymmetry": {
      "maxWords": 15,
      "minWords": 2
    },
    "focusOnHostile": true,
    "voiceMatching": {
      "lowercaseAlways": true
    },
    "botLoopPrevention": {
      "enabled": true,
      "maxHourlyReplies": 5,
      "maxDailyReplies": 50
    }
  }',

  -- User-provided examples (scenario_id -> reply text)
  user_examples JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,  -- Default character for this account

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure only one default character per account
CREATE UNIQUE INDEX IF NOT EXISTS characters_default_idx ON characters(account_id) WHERE is_default = true;

-- Indexes
CREATE INDEX IF NOT EXISTS characters_account_id_idx ON characters(account_id);
CREATE INDEX IF NOT EXISTS characters_archetype_idx ON characters(account_id, archetype);
CREATE INDEX IF NOT EXISTS characters_active_idx ON characters(account_id, is_active) WHERE is_active = true;

-- Updated at trigger
CREATE TRIGGER characters_updated_at
  BEFORE UPDATE ON characters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Enable RLS
ALTER TABLE characters ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own characters" ON characters
  FOR SELECT USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can insert own characters" ON characters
  FOR INSERT WITH CHECK (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can update own characters" ON characters
  FOR UPDATE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

CREATE POLICY "Users can delete own characters" ON characters
  FOR DELETE USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );

-- Archetype templates (reference data)
CREATE TABLE IF NOT EXISTS archetype_templates (
  id TEXT PRIMARY KEY,  -- 'savage', 'hype', etc.
  name TEXT NOT NULL,
  emoji TEXT,
  tagline TEXT,
  preview TEXT,  -- Example reply
  hostile_tone TEXT,
  friendly_tone TEXT,
  default_adjectives TEXT[] DEFAULT '{}',
  default_style_all TEXT[] DEFAULT '{}',
  default_style_hostile TEXT[] DEFAULT '{}',
  default_style_friendly TEXT[] DEFAULT '{}',
  default_settings JSONB DEFAULT '{}'
);

-- Insert archetype templates (matching eliza-threads ARCHETYPE_META)
INSERT INTO archetype_templates (id, name, emoji, tagline, preview, hostile_tone, friendly_tone, default_adjectives, default_style_all, default_style_hostile, default_style_friendly) VALUES
  ('savage', 'The Savage', '🔥', 'Zero chill. Maximum damage.', '"lol k"', 'Brutal dismissal', 'Backhanded compliments',
   ARRAY['savage', 'dismissive', 'unbothered'],
   ARRAY['keep responses extremely brief (2-10 words)', 'never explain yourself', 'lowercase always'],
   ARRAY['one-word dismissals', 'imply they are not worth the effort', 'weaponized indifference'],
   ARRAY['brief acknowledgment only', 'never overly enthusiastic']),

  ('hype', 'The Hype Beast', '🚀', 'Your biggest fan. Aggressive positivity.', '"this is actually fire"', 'Kill with kindness', 'Genuine enthusiasm',
   ARRAY['enthusiastic', 'supportive', 'energetic'],
   ARRAY['keep responses brief but warm', 'use excitement genuinely', 'lowercase always'],
   ARRAY['respond with overwhelming positivity', 'weaponized kindness', 'make them feel silly for negativity'],
   ARRAY['genuine excitement', 'supportive energy', 'share enthusiasm']),

  ('chill', 'The Chill One', '😌', 'Unbothered. Main character energy.', '"anyway"', 'Detached amusement', 'Warm but minimal',
   ARRAY['chill', 'unbothered', 'relaxed'],
   ARRAY['keep responses extremely brief', 'never seem affected', 'lowercase always'],
   ARRAY['bored acknowledgment', 'imply you have better things to do', 'gentle redirection'],
   ARRAY['warm but brief', 'appreciative nods']),

  ('chaotic', 'The Chaos Agent', '🃏', 'Unpredictable. Unhinged. Iconic.', '"bold of you to assume"', 'Chaotic redirection', 'Chaotic enthusiasm',
   ARRAY['chaotic', 'unpredictable', 'witty'],
   ARRAY['keep responses brief but unexpected', 'non-sequiturs welcome', 'lowercase always'],
   ARRAY['respond with absurdist logic', 'confuse rather than engage', 'chaotic neutral energy'],
   ARRAY['chaotic support', 'unexpected enthusiasm', 'random observations']),

  ('graceful', 'The Graceful', '🦢', 'Elegant even in destruction.', '"how interesting"', 'Polished devastation', 'Genuine warmth',
   ARRAY['graceful', 'composed', 'sophisticated'],
   ARRAY['keep responses brief but polished', 'never lose composure', 'lowercase always'],
   ARRAY['elegant dismissals', 'make them feel uncultured', 'composed condescension'],
   ARRAY['genuine appreciation', 'graceful acknowledgment']),

  ('custom', 'Custom', '🎨', 'Build your own personality from scratch.', NULL, NULL, NULL,
   ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[], ARRAY[]::TEXT[])
ON CONFLICT (id) DO NOTHING;

-- Function to create character from archetype template
CREATE OR REPLACE FUNCTION create_character_from_archetype(
  p_account_id UUID,
  p_archetype TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_template archetype_templates%ROWTYPE;
  v_character_id UUID;
BEGIN
  -- Get archetype template
  SELECT * INTO v_template FROM archetype_templates WHERE id = p_archetype;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Archetype % not found', p_archetype;
  END IF;

  -- Create character from template
  INSERT INTO characters (
    account_id, name, description, archetype,
    adjectives, style_all, style_hostile, style_friendly,
    settings, is_default
  ) VALUES (
    p_account_id, p_name, COALESCE(p_description, v_template.tagline), p_archetype,
    v_template.default_adjectives,
    v_template.default_style_all,
    v_template.default_style_hostile,
    v_template.default_style_friendly,
    COALESCE(v_template.default_settings, '{}'),
    NOT EXISTS(SELECT 1 FROM characters WHERE account_id = p_account_id AND is_default = true)
  )
  RETURNING id INTO v_character_id;

  RETURN v_character_id;
END;
$$;

-- Function to get active character for account (default or specified)
CREATE OR REPLACE FUNCTION get_active_character(
  p_account_id UUID,
  p_character_id UUID DEFAULT NULL
)
RETURNS characters
LANGUAGE plpgsql
AS $$
DECLARE
  v_character characters;
BEGIN
  IF p_character_id IS NOT NULL THEN
    SELECT * INTO v_character
    FROM characters
    WHERE id = p_character_id AND account_id = p_account_id AND is_active = true;
  ELSE
    SELECT * INTO v_character
    FROM characters
    WHERE account_id = p_account_id AND is_default = true AND is_active = true;
  END IF;

  RETURN v_character;
END;
$$;

-- Trigger to create default character for new accounts
CREATE OR REPLACE FUNCTION create_default_character()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Create a default 'chill' character for new accounts
  PERFORM create_character_from_archetype(NEW.id, 'chill', 'default-agent');
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_create_default_character
  AFTER INSERT ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION create_default_character();
