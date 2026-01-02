# Threadsponder SaaS Architecture

Multi-tenant AI reply agent platform for Threads (Meta) with subscription billing, character customization, and RAG-powered responses.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js)                            │
│  Dashboard │ Character Builder │ Voice Training │ Analytics │ Billing  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          API LAYER (Hono/tRPC)                          │
│  /api/accounts │ /api/threads │ /api/characters │ /api/replies │ webhooks
└─────────────────────────────────────────────────────────────────────────┘
                    │                               │
        ┌───────────┴───────────┐       ┌──────────┴──────────┐
        ▼                       ▼       ▼                      ▼
┌───────────────┐    ┌─────────────────────┐    ┌─────────────────────────┐
│    Clerk      │    │     Supabase        │    │      DragonflyDB        │
│  (Auth/Users) │    │  (PostgreSQL+RLS)   │    │   (Redis-compatible)    │
│               │    │   - Accounts        │    │   - Session cache       │
│  - SSO/OAuth  │    │   - Characters      │    │   - Rate limiting       │
│  - Webhooks   │    │   - Voice examples  │    │   - Reply dedup         │
│  - Sessions   │    │   - Ammunition(RAG) │    │   - Vector index (HNSW) │
└───────────────┘    │   - Usage/Billing   │    │   - Bot loop prevention │
                     │   - History         │    └─────────────────────────┘
                     └─────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         WORKER LAYER (BullMQ)                           │
│  Reply Generator │ Classifier │ Embedding Generator │ Webhook Processor │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐        ┌─────────────────┐        ┌─────────────────────┐
│  OpenRouter   │        │  Threads API    │        │      Upstash        │
│  (LLM Access) │        │  (Meta Graph)   │        │  (Queue/Scheduler)  │
│               │        │                 │        │                     │
│ - Gemini 2.5  │        │ - Read replies  │        │ - BullMQ backend    │
│ - Claude      │        │ - Post replies  │        │ - Cron schedules    │
│ - Qwen (embed)│        │ - Webhooks      │        │ - Retry logic       │
└───────────────┘        └─────────────────┘        └─────────────────────┘
```

---

## Database Schema (Supabase/PostgreSQL)

### Core Tables

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `accounts` | Multi-tenant root | Clerk integration, subscription status |
| `threads_accounts` | Threads API credentials | Encrypted tokens, per-account |
| `characters` | AI personality configs | Archetypes, style rules, settings |
| `voice_examples` | Voice training data | pgvector embeddings (1024-dim) |
| `ammunition` | RAG knowledge base | Hybrid search (BM25 + vector) |
| `focused_posts` | Posts being monitored | Active reply targets |
| `scheduled_posts` | Queued content | Future posting schedule |
| `friends` | Known friendly accounts | Banter/roast mode toggles |
| `reply_history` | All generated replies | Analytics, deduplication |
| `usage_events` | Billing/monitoring | Token tracking, costs |
| `usage_periods` | Monthly billing cycles | Aggregated usage per period |
| `subscription_tiers` | Plan definitions | Limits, features, pricing |

### Row Level Security (RLS)

All tables use Clerk-based tenant isolation:

```sql
CREATE POLICY "tenant_isolation" ON table_name
  FOR ALL USING (
    account_id IN (
      SELECT id FROM accounts
      WHERE clerk_user_id = current_setting('app.clerk_user_id', true)
    )
  );
```

### Vector Indexes (pgvector)

```sql
-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX voice_examples_embedding_idx ON voice_examples
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Same for ammunition
CREATE INDEX ammunition_embedding_idx ON ammunition
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## Authentication Flow

```
1. User visits dashboard
2. Clerk handles OAuth (Google, Apple, etc.)
3. Clerk webhook → creates/updates accounts row
4. JWT includes clerk_user_id
5. API sets postgres setting: SET app.clerk_user_id = 'clerk_xxx'
6. RLS policies filter all queries to tenant's data
```

### Clerk Webhook Events

- `user.created` → Create account (no active subscription until purchase)
- `user.updated` → Sync profile changes
- `user.deleted` → Cascade delete (soft or hard)

---

## Character/Archetype System

### Pre-built Archetypes

| Archetype | Personality | Hostile Response | Friendly Response |
|-----------|-------------|------------------|-------------------|
| `savage` | Brutal honesty, zero chill | One-word dismissals | Backhanded compliments |
| `hype` | Enthusiastic, positive | Kill with kindness | Genuine excitement |
| `chill` | Unbothered, relaxed | Detached amusement | Warm but minimal |
| `chaotic` | Unpredictable, witty | Absurdist redirection | Random enthusiasm |
| `graceful` | Elegant, composed | Polished devastation | Genuine warmth |
| `custom` | User-defined | User-defined | User-defined |

### Character Settings (JSONB)

```json
{
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
}
```

---

## RAG / Sniper Ammunition System

### Purpose
Retrieve factual "ammunition" to power fact-based dunks and informed replies.

### Architecture

```
Hostile Comment: "AI art is theft!"
         │
         ▼
┌─────────────────────────────────────┐
│     Query Transformation            │
│  Extract keywords: "AI art legal"   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│        Hybrid Search                │
│  BM25 (keywords) + Vector (semantic)│
│  Reciprocal Rank Fusion (α=0.7)     │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│       Result: "Judge Alsup ruled    │
│       AI training is fair use..."   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│    Inject into LLM prompt           │
│    Generate fact-based dunk         │
└─────────────────────────────────────┘
```

### Search Functions

```sql
-- Pure vector search
search_ammunition(account_id, embedding, category, limit)

-- Hybrid search (recommended)
hybrid_search_ammunition(account_id, query, embedding, alpha, limit)
```

### Ammunition Categories

- `legal` - Court cases, rulings, laws
- `statistical` - Data, studies, numbers
- `technical` - Technical facts, how things work
- `historical` - Historical events, precedents
- `quotation` - Expert quotes
- `definition` - Definitions, clarifications
- `general` - General facts

---

## Voice Training System

### Purpose
Learn user's unique voice through examples, enabling consistent persona matching.

### Training Scenarios

| ID | Type | Prompt Example |
|----|------|----------------|
| `hostile_basic` | hostile | "this is garbage" |
| `hostile_dismissive` | hostile | "who asked" |
| `hostile_rant` | rant | "you're everything wrong with..." |
| `friendly_basic` | friendly | "love this!" |
| `neutral_question` | neutral | "how does this work?" |
| `meta_callout` | meta | "this is clearly AI generated" |

### Embedding Flow

```
User Example → Qwen 8B Embedding (1024-dim) → pgvector HNSW Index
                                                      │
Reply Generation ← Voice Search ← Query Embedding ←───┘
```

---

## Subscription Tiers

### Duration-Based Pricing

All tiers include **full feature access** - the difference is billing frequency:

| Plan | Price | Duration | Best For |
|------|-------|----------|----------|
| **Daily Pass** | $1.99 | 1 day | Try it out, occasional use |
| **Weekly Pass** | $9.99 | 7 days | Short campaigns, testing |
| **Monthly Pass** | $24.99 | 30 days | Regular users, best value |

### Features (All Tiers)

| Feature | Included |
|---------|----------|
| Daily Replies | 500 |
| Daily Classifications | 1,000 |
| Daily Posts | 50 |
| Custom Characters | ✓ |
| Ammunition RAG | ✓ |
| Voice Training | ✓ |
| API Access | ✓ |
| Webhooks | ✓ |
| Max Accounts | 5 |
| Max Focused Posts | 20 |
| Max Friends | 100 |
| Data Retention | 90 days |
| Priority Support | ✓ |

### Period Limits (Scaled by Duration)

| Resource | Daily | Weekly | Monthly |
|----------|-------|--------|---------|
| Tokens | 100K | 700K | 3M |
| Embeddings | 500 | 3,500 | 15,000 |

### Usage Enforcement

```sql
-- Check before action
SELECT can_perform_action(account_id, 'reply');
-- Returns: { allowed: true/false, reason: "...", daily_used: N, daily_limit: M }

-- Increment after action
SELECT increment_usage(account_id, 'reply', tokens, cost_millicents);
```

---

## Worker Architecture

### Job Types (BullMQ)

| Queue | Job | Priority | Concurrency |
|-------|-----|----------|-------------|
| `replies` | Generate reply | High | 10 |
| `classify` | Classify comment | Medium | 20 |
| `embed` | Generate embedding | Low | 5 |
| `webhooks` | Process Threads webhook | Critical | 5 |
| `scheduled` | Post scheduled content | Medium | 3 |

### Reply Generation Flow

```
1. Webhook: New reply on focused post
2. Queue: 'classify' job created
3. Classifier: Determine sentiment (hostile/friendly/neutral)
4. Queue: 'replies' job created (if hostile & within limits)
5. Generator:
   a. Load character config
   b. Search voice examples (similarity)
   c. Search ammunition (hybrid, if enabled)
   d. Generate via OpenRouter (Gemini 2.5)
   e. Apply post-processing (lowercase, word limits)
6. Post: Send to Threads API
7. Track: Log to reply_history, increment usage
```

---

## DragonflyDB (Redis-compatible)

### Key Patterns

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `session:{account_id}` | Active session cache | 24h |
| `rate:{account_id}:{action}` | Rate limiting | 1h |
| `replied:{thread_id}` | Dedup prevention | 24h |
| `bot_check:{username}` | Bot loop prevention | 1h |
| `embed:{hash}` | Embedding cache | 24h |

### Vector Index (if using DragonflyDB for RAG)

```redis
FT.CREATE idx:ammo ON JSON PREFIX 1 ammo:
  SCHEMA $.content AS content TEXT
         $.embedding AS embedding VECTOR HNSW 6
           TYPE FLOAT32 DIM 1024 DISTANCE_METRIC COSINE
```

---

## API Routes

### Dashboard API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/accounts` | Get current account |
| PATCH | `/api/accounts` | Update account settings |
| GET | `/api/characters` | List characters |
| POST | `/api/characters` | Create character |
| PUT | `/api/characters/:id` | Update character |
| DELETE | `/api/characters/:id` | Delete character |
| GET | `/api/voice-examples` | List training examples |
| POST | `/api/voice-examples` | Add training example |
| GET | `/api/ammunition` | List ammunition |
| POST | `/api/ammunition` | Add ammunition |
| GET | `/api/analytics` | Usage analytics |
| GET | `/api/history` | Reply history |

### Webhook Routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/webhooks/clerk` | Clerk user events |
| POST | `/api/webhooks/threads` | Threads reply notifications |
| POST | `/api/webhooks/stripe` | Billing events |

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Vercel (Frontend)                          │
│  Next.js App │ API Routes │ Edge Functions │ Clerk Middleware      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   Supabase    │        │    Upstash      │        │   Railway/Fly   │
│  (Database)   │        │  (Redis/Queue)  │        │   (Workers)     │
│               │        │                 │        │                 │
│ - PostgreSQL  │        │ - BullMQ queues │        │ - Reply worker  │
│ - pgvector    │        │ - Rate limits   │        │ - Embed worker  │
│ - RLS         │        │ - Cron triggers │        │ - Webhook proc  │
└───────────────┘        └─────────────────┘        └─────────────────┘
```

---

## Security Considerations

### Data Protection
- All Threads tokens encrypted at rest (AES-256-GCM)
- RLS enforces tenant isolation at database level
- No cross-tenant data leakage possible

### Rate Limiting
- Per-account limits enforced via subscription tier
- DragonflyDB-backed sliding window counters
- Graceful degradation on limit breach

### Bot Loop Prevention
- Track replied-to threads (24h TTL)
- Detect bot accounts via username patterns
- Max hourly/daily reply limits per account

### Secrets Management
- Clerk handles all user auth
- Supabase manages database secrets
- Environment variables for API keys

---

## Migration Path from eliza-threads

### Feature Parity Checklist

| Feature | eliza-threads | threadsponder | Status |
|---------|--------------|---------------|--------|
| Character System | ThreadfireCharacter | characters table | ✅ Parity |
| Voice Training | voice_examples | voice_examples | ✅ Parity |
| Ammunition RAG | research-provider | ammunition + functions | ✅ Parity |
| Bot Loop Prevention | memory + cooldowns | DragonflyDB + settings | ✅ Parity |
| Usage Tracking | - | usage_events | ✅ Enhanced |
| Multi-tenant | Single user | RLS + Clerk | ✅ Enhanced |
| Billing | - | subscription_tiers | ✅ Added |

### Data Migration

```sql
-- Migrate characters from eliza-threads JSON to threadsponder
INSERT INTO characters (account_id, name, archetype, ...)
SELECT ..., character_json->>'name', character_json->>'archetype'
FROM eliza_export;
```

---

## Monitoring & Observability

### Key Metrics

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Reply latency P50 | usage_events | > 3s |
| Daily active accounts | accounts | Drop > 20% |
| Token usage | usage_events | > 80% of tier |
| Error rate | workers | > 5% |
| Queue depth | Upstash | > 100 jobs |

### Dashboards

- **Account Health**: Usage, limits, feature access
- **Reply Performance**: Latency, success rate, sentiment distribution
- **RAG Effectiveness**: Hit rate, relevance scores
- **Billing**: Revenue, churn, tier distribution

---

## Future Enhancements

1. **Multi-platform**: Expand to Twitter/X, Instagram, Bluesky
2. **Team Accounts**: Multiple users per account
3. **Custom Models**: Fine-tuned LLMs per account
4. **Analytics Dashboard**: Deep reply performance insights
5. **A/B Testing**: Test different character configs
6. **Scheduled Campaigns**: Bulk reply scheduling
7. **API Marketplace**: Third-party integrations

---

## Quick Start (Development)

```bash
# 1. Clone and install
git clone https://github.com/your-org/threadsponder
cd threadsponder
pnpm install

# 2. Set up environment
cp .env.example .env.local
# Fill in: CLERK_*, SUPABASE_*, UPSTASH_*, OPENROUTER_*

# 3. Run migrations
supabase db push

# 4. Start development
pnpm dev          # Dashboard
pnpm dev:workers  # Background workers
```

---

*Last updated: 2025-12-31*
