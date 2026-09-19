# Threadsponder Architecture

## What It Does

Threadsponder monitors your Threads posts for replies, classifies each reply (hostile, friendly, neutral), generates a voice-matched response using AI, and queues it for human approval — replies only post automatically when the two-key auto-post system (per-account `requireApproval=false` + `THREADS_AUTO_POST=true`) is explicitly enabled. It also supports scheduled posts, voice training from uploaded documents, and bot-loop prevention.

## System Overview

```
Dashboard (React/Vite) -> API (Express) -> Supabase (Postgres)
                                       \-> Workers (BullMQ/Redis)
                                             |-- Reply Monitor (every 1min)
                                             |-- Post Scheduler (every 1min)
                                             |-- Voice Processor (on-demand)
                                             |-- Metrics Collector (every 5min)
```

## Packages

### `packages/shared`
Types, clients, and utilities shared across all packages.

- **ThreadsClient** — Threads Graph API wrapper. Post creation, reply fetching, media handling.
- **Types** — Database row types, API request/response shapes.
- **Security** — AES-256-GCM credential encryption for Threads tokens.
- **Redis** — Upstash client wrapper, tenant-scoped key patterns.

### `packages/api`
Express REST API. Serves the dashboard and manages data.

**Routes:**
| Route | Purpose |
|-------|---------|
| `/api/auth/threads` | Threads OAuth flow (initiate + callback) |
| `/api/threads/*` | Manage connected Threads accounts |
| `/api/voice/*` | Voice examples CRUD, settings, document upload |
| `/api/posts/*` | Focused posts + scheduled posts CRUD |
| `/api/friends/*` | Friends list with banter/roast modes |
| `/api/analytics/*` | Reply history, charts, performance |
| `/api/finetune/*` | Reply rating, auto-eval, pattern tracking |
| `/api/stats/*` | Achievement stats |

The API runs in standalone mode — no external auth needed. A default account is auto-created on first request. Threads credentials are auto-seeded from `THREADS_ACCESS_TOKEN` and `THREADS_USER_ID` env vars.

### `packages/workers`
Background job processors. Runs BullMQ workers + cron schedulers.

**Reply Monitor** (every minute):
1. Fetch replies on your focused posts via Threads API
2. Skip: already processed, too old (>24h), too deep (>3 levels), own replies
3. Classify reply (hostile/friendly/neutral) via fast classifier
4. Run evaluator checks (bot loop, cooldown, blocklist) — fail open on errors
5. Generate voice-matched response via OpenRouter
6. Queue reply in `pending_replies` for human approval (`bin/human-queue review` — records the decision only, never publishes). Auto-post only when per-account `requireApproval=false` AND `THREADS_AUTO_POST=true` are both set (fail-closed default)
7. Track in reply_history + engagement metrics

**Discovery** (every 5 min, opt-in per account via `automation_settings.discovery_enabled`): read-only search over configured queries; candidates land in `discovery_candidates` and never feed the reply monitor.

**Operator-queue retention** (daily at 03:00): prunes answered/expired `pending_inference`, decided `pending_replies`, and reviewed `discovery_candidates`.

**Post Scheduler** (every minute):
1. Query `scheduled_posts` where `scheduled_for <= now` and `status = 'pending'`
2. Detect media type from URL extension (image/video)
3. Publish via Threads API
4. Update status

**Voice Processor** (triggered by document upload):
1. Download document from Supabase Storage
2. Extract text (.txt, .md, .pdf, .docx)
3. Chunk semantically using Chonkie (512-char, 50-char overlap)
4. Classify tone per chunk (friendly/neutral/hostile)
5. Generate 1024-dim embeddings via text-embedding-3-large
6. Store in `voice_examples` with HNSW vector index

### `packages/dashboard`
React + Vite frontend with Tailwind + Radix UI. Pages for voice training, character building, analytics, and account management.

## Evaluator System

Three-layer bot protection in `packages/workers/src/evaluators/`:

**BotLoopDetector** — Prevents infinite reply chains:
- Rate limits per user per thread per hour
- Max 3 conversation depths per thread
- Output dedup (won't post the same text twice)

**ShouldReplyEvaluator** — Pre-reply gate:
- Blocklist (`blocked_users` table)
- Dedup (`replied_comments` table)
- Cooldown (30min per user via `user_cooldowns`)
- Min confidence threshold (0.6)

**EngagementTracker** — Post-reply learning:
- Effort ratio (our response vs hostile text length)
- Pattern performance tracking
- Best posting hours

**EvaluatorsOrchestrator** — Unified interface:
- `evaluate(input)` → `{ shouldReply, reason }`
- `trackReply(input)` → records outcome, sets cooldowns

All errors **fail open** — evaluators are safety layers, not gates.

## Classification & Response

**Classification** (`fast-classifier.ts`):
- Uses GLM-4.7 via Z.AI for speed (falls back to OpenRouter)
- Prompt injection detection
- Meta-awareness ("you're a bot" handling)
- Output: `{ classification, confidence, injectionDetected }`

**Response Generation** (`responder.ts`):
- Voice matching via pgvector similarity search on `voice_examples`
- Style analysis (energy, formality, brevity, emoji)
- Friend-aware (banter/roast modes)
- Layered prompting: voice match → friend mode → meta-awareness → confidence pivots

## Database

PostgreSQL via Supabase with 18 migrations and pgvector for embeddings.

**Core tables:** `accounts`, `threads_accounts` (encrypted tokens)
**Voice:** `voice_examples` (1024-dim vectors, HNSW index), `voice_settings`, `voice_documents`
**Content:** `focused_posts`, `scheduled_posts`, `reply_history`
**Safety:** `blocked_users`, `user_cooldowns`, `replied_comments`, `bot_loop_*` tables
**Analytics:** `engagement_metrics`, `post_metrics`, `post_performance`

## Key Files

| File | What It Does |
|------|-------------|
| `packages/workers/src/index.ts` | Worker entry, cron scheduling, graceful shutdown |
| `packages/workers/src/jobs/reply-monitor.ts` | Core reply monitoring loop |
| `packages/workers/src/jobs/post-scheduler.ts` | Scheduled post publisher |
| `packages/workers/src/jobs/voice-processor.ts` | Document → chunks → embeddings pipeline |
| `packages/workers/src/evaluators/index.ts` | Bot loop + should-reply + engagement orchestrator |
| `packages/workers/src/utils/fast-classifier.ts` | Reply classification |
| `packages/workers/src/utils/responder.ts` | Voice-matched response generation |
| `packages/api/src/routes/auth.ts` | Threads OAuth flow |
| `packages/api/src/routes/voice.ts` | Voice training API |
| `packages/shared/src/clients/threads.ts` | Threads Graph API client |
