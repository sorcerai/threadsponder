# Threadsponder — Builder Agent Playbook

Machine-executable setup guide for AI coding agents. Follow steps in order. Each step has a verification check.

This sets up Threadsponder as a personal Threads auto-reply bot. No auth framework needed — it runs locally with direct database access.

## Prerequisites

```bash
node --version   # >= 18
pnpm --version   # >= 9 (install: npm install -g pnpm)
```

## Project Structure

```
packages/
  shared/     — Types, ThreadsClient, encryption, Redis utils
  api/        — Express REST API (voice training, posts, analytics)
  workers/    — BullMQ background jobs (reply monitor, post scheduler, voice processor)
  dashboard/  — React + Vite frontend (voice training, analytics, account management)
supabase/
  migrations/ — 18 SQL migration files (run in order, 001-018)
```

---

## Step 1: Install

```bash
pnpm install
```

**Verify:** `pnpm ls --depth 0` lists 4 workspace packages.

## Step 2: Supabase Database

Create a Supabase project at supabase.com. Get three values from **Settings > API**:
- `SUPABASE_URL` (project URL)
- `SUPABASE_ANON_KEY` (public anon key)
- `SUPABASE_SERVICE_KEY` (service_role key — server-side only)

Enable pgvector:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Run all 18 migrations:
```bash
npx supabase link --project-ref YOUR_REF
npx supabase db push
```

**Verify:** `voice_examples` table exists with an `embedding vector(1024)` column.

## Step 3: Upstash Redis

Create a Redis database at upstash.com. Get:
- `UPSTASH_REDIS_URL` — TCP connection: `redis://default:PASSWORD@ENDPOINT.upstash.io:6379`
- `UPSTASH_REDIS_REST_URL` — REST endpoint: `https://ENDPOINT.upstash.io`
- `UPSTASH_REDIS_REST_TOKEN` — REST auth token

**Verify:** Upstash console shows the database as active.

## Step 4: OpenRouter API Key

Get a key from openrouter.ai. Set:
- `OPENROUTER_API_KEY` — starts with `sk-or-v1-`

**Verify:**
```bash
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 100
```
Returns JSON model data (not an error).

## Step 5: Encryption Key

Generate a key for encrypting Threads tokens at rest:
```bash
openssl rand -base64 32
```

Set as `CREDENTIAL_ENCRYPTION_KEY`.

## Step 6: Write .env

Create `.env` in project root:

```env
# --- Required ---
SUPABASE_URL=<from step 2>
SUPABASE_ANON_KEY=<from step 2>
SUPABASE_SERVICE_KEY=<from step 2>
UPSTASH_REDIS_URL=<from step 3>
UPSTASH_REDIS_REST_URL=<from step 3>
UPSTASH_REDIS_REST_TOKEN=<from step 3>
OPENROUTER_API_KEY=<from step 4>
CREDENTIAL_ENCRYPTION_KEY=<from step 5>

# --- App config ---
PORT=3008
NODE_ENV=development
DEFAULT_ORG_ID=default
DASHBOARD_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
APP_URL=http://localhost:3008

# --- Optional ---
# Z_AI_API_KEY=          # Faster classification via GLM-4.7
# RESEND_API_KEY=        # Email notifications
# STRIPE_SECRET_KEY=     # Billing (SaaS mode only)
# CLERK_SECRET_KEY=      # Multi-user auth (SaaS mode only)
```

**Verify:** All required values are non-empty.

## Step 7: Build and Typecheck

```bash
pnpm build
pnpm typecheck
```

**Verify:** Both exit 0.

## Step 8: Run

```bash
pnpm dev
```

Starts:
- API on `:3008`
- Workers (health server on `:8080`)
- Dashboard on `:5173`

**Verify:**
```bash
curl http://localhost:3008/health
# Returns: {"status":"ok",...}
```

## MANUAL STEP: Get Threads Credentials

You need a Threads access token and user ID. These come from Meta's developer console.

1. Create an app at developers.facebook.com
2. Add the "Threads API" product
3. Generate an access token via the API Explorer or OAuth flow
4. Get your Threads user ID
5. Add to `.env`:
   ```env
   THREADS_ACCESS_TOKEN=your-access-token
   THREADS_USER_ID=your-user-id
   THREADS_USERNAME=your-username
   ```
6. Restart — the system auto-seeds these credentials into the database on first startup.

Without this step, the reply monitor runs but has no account to process.

---

## Quick Reference

### How Replies Work

```
Cron (every 1min)
  -> Find accounts with connected Threads + focused posts
  -> For each focused post, fetch new replies via Threads API
  -> Classify each reply (hostile / friendly / neutral)
  -> Evaluate: bot loop check, cooldown check, blocklist check (fails open)
  -> Generate voice-matched response via OpenRouter
  -> Post reply via Threads API
  -> Record in reply_history + track engagement
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/workers/src/index.ts` | Worker entry, cron scheduling |
| `packages/workers/src/jobs/reply-monitor.ts` | Reply monitoring job |
| `packages/workers/src/jobs/post-scheduler.ts` | Scheduled post publishing |
| `packages/workers/src/jobs/voice-processor.ts` | Document → chunks → embeddings |
| `packages/workers/src/evaluators/index.ts` | Bot loop + should-reply orchestrator |
| `packages/workers/src/utils/fast-classifier.ts` | Reply classification |
| `packages/workers/src/utils/responder.ts` | Voice-matched response generation |
| `packages/api/src/routes/auth.ts` | Threads OAuth flow |
| `packages/api/src/routes/voice.ts` | Voice training API |
| `packages/shared/src/clients/threads.ts` | Threads Graph API client |

### Database Tables (18 migrations)

| Category | Tables |
|----------|--------|
| Core | `accounts`, `threads_accounts` (encrypted tokens) |
| Voice | `voice_examples` (pgvector), `voice_settings`, `voice_documents`, `characters`, `archetype_templates` |
| Content | `focused_posts`, `scheduled_posts`, `reply_history` |
| Safety | `blocked_users`, `user_cooldowns`, `replied_comments`, `bot_loop_rates`, `bot_loop_depths`, `bot_loop_outputs` |
| Analytics | `engagement_metrics`, `engagement_hourly_stats`, `engagement_pattern_stats`, `post_metrics`, `post_performance` |
| Other | `ammunition`, `banned_phrases`, `user_dossiers`, `usage_events`, `subscription_tiers` |

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Database URL |
| `SUPABASE_ANON_KEY` | Yes | Public database key |
| `SUPABASE_SERVICE_KEY` | Yes | Server database key |
| `UPSTASH_REDIS_URL` | Yes | BullMQ queue (TCP) |
| `UPSTASH_REDIS_REST_URL` | Yes | Redis REST access |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Redis REST auth |
| `OPENROUTER_API_KEY` | Yes | LLM responses + embeddings |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Encrypt Threads tokens |
| `PORT` | No | API port (default: 3008) |
| `NODE_ENV` | No | Environment mode |
| `DEFAULT_ORG_ID` | No | Org ID for local use (default: "default") |
| `Z_AI_API_KEY` | No | Faster classification |
| `THREADS_ACCESS_TOKEN` | No* | Threads API token (auto-seeded on startup) |
| `THREADS_USER_ID` | No* | Threads user ID (auto-seeded on startup) |
| `THREADS_USERNAME` | No | Display name for your account |

*Required for the reply monitor to work, but the system starts without them.

### Build Commands

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm typecheck     # Type-check all packages
pnpm dev           # Run all packages in dev mode
pnpm clean         # Clean build artifacts
```

### After Setup: Using Threadsponder

1. **Connect Threads account** (manual OAuth — see above)
2. **Add focused posts** — Posts whose replies get auto-monitored
3. **Add voice examples** — Train how your bot sounds (manual text or upload documents)
4. **Adjust voice settings** — Tune formality, brevity, emoji usage, aggression sliders
5. **Add friends** — Set banter/roast modes for specific usernames
6. The reply monitor runs automatically every minute from there
