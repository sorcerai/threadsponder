# Threadsponder — Builder Agent Playbook

Machine-executable setup guide for AI coding agents. Follow steps in order. Each step has a verification check.

This sets up Threadsponder as a personal Threads auto-reply bot. Zero external dependencies — SQLite for storage, in-memory maps for state.

## Prerequisites

```bash
node --version   # >= 18
pnpm --version   # >= 9 (install: npm install -g pnpm)
```

## Project Structure

```
packages/
  shared/     — Types, ThreadsClient, encryption, SQLite client, KV store
  api/        — Express REST API (voice training, posts, analytics)
  workers/    — Background jobs via node-cron (reply monitor, post scheduler, voice processor)
  dashboard/  — React + Vite frontend (voice training, analytics, account management)
```

---

## Step 1: Install

```bash
pnpm install
```

**Verify:** `pnpm ls --depth 0` lists 4 workspace packages.

## Step 2: OpenRouter API Key

Get a key from openrouter.ai. Set:
- `OPENROUTER_API_KEY` — starts with `sk-or-v1-`

**Verify:**
```bash
curl -s https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 100
```
Returns JSON model data (not an error).

## Step 3: Encryption Key

Generate a key for encrypting Threads tokens at rest:
```bash
openssl rand -base64 32
```

Set as `CREDENTIAL_ENCRYPTION_KEY`.

## Step 4: Write .env

Create `.env` in project root:

```env
# --- Required ---
OPENROUTER_API_KEY=<from step 2>
CREDENTIAL_ENCRYPTION_KEY=<from step 3>

# --- App config ---
PORT=3008
NODE_ENV=development
DEFAULT_ORG_ID=default
DASHBOARD_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
APP_URL=http://localhost:3008

# --- Optional ---
# SQLITE_DB_PATH=./threadsponder.db  # default: ./threadsponder.db
# Z_AI_API_KEY=                       # Faster classification via GLM-4.7
# RESEND_API_KEY=                     # Email notifications
```

**Verify:** All required values are non-empty.

## Step 5: Build and Typecheck

```bash
pnpm build
pnpm typecheck
```

**Verify:** Both exit 0.

## Step 6: Run

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
  -> Generate voice-matched response via OpenRouter
  -> Post reply via Threads API
  -> Record in reply_history
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/workers/src/index.ts` | Worker entry, cron scheduling |
| `packages/workers/src/jobs/reply-monitor.ts` | Reply monitoring job |
| `packages/workers/src/jobs/post-scheduler.ts` | Scheduled post publishing |
| `packages/workers/src/jobs/voice-processor.ts` | Document processing |
| `packages/workers/src/jobs/metrics-collector.ts` | Post metrics snapshots |
| `packages/workers/src/utils/fast-classifier.ts` | Reply classification |
| `packages/workers/src/utils/responder.ts` | Voice-matched response generation |
| `packages/api/src/routes/auth.ts` | Threads OAuth flow |
| `packages/api/src/routes/voice.ts` | Voice training API |
| `packages/shared/src/clients/threads.ts` | Threads Graph API client |
| `packages/shared/src/db/sqlite.ts` | SQLite schema + connection |

### Database (SQLite — auto-created)

| Category | Tables |
|----------|--------|
| Core | `accounts`, `threads_accounts` (encrypted tokens) |
| Voice | `voice_examples` (embeddings as JSON), `voice_settings`, `voice_processing_queue` |
| Content | `focused_posts`, `scheduled_posts`, `reply_history` |
| Safety | `blocked_users`, `user_cooldowns`, `bot_loop_rates` |
| Analytics | `post_metrics` |
| Other | `ammunition`, `banned_phrases`, `usage_events` |

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | Yes | LLM responses + embeddings |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Encrypt Threads tokens |
| `SQLITE_DB_PATH` | No | Database file path (default: `./threadsponder.db`) |
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
