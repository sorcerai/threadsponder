# Threadsponder

Auto-reply bot for Threads. Monitors your posts for replies, classifies them (hostile/friendly/neutral), and generates voice-matched responses using AI.

**Zero external dependencies** — runs entirely on SQLite + Node.js. No Supabase, no Redis, no managed services required.

## How it works

```
Cron (every 1 min)
  -> Find accounts with connected Threads + focused posts
  -> Fetch new replies via Threads API
  -> Classify each reply (hostile / friendly / neutral)
  -> Generate voice-matched response via OpenRouter
  -> Post reply via Threads API
  -> Record in reply_history
```

## Quick start

```bash
# Prerequisites: Node >= 18, pnpm >= 9
pnpm install
cp .env.example .env
# Fill in OPENROUTER_API_KEY and CREDENTIAL_ENCRYPTION_KEY (see below)
pnpm build
pnpm dev
```

### Required environment variables

| Variable | How to get it |
|---|---|
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) — starts with `sk-or-v1-` |
| `CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -base64 32` |

### Connect your Threads account

Add these to `.env`, then restart:

```env
THREADS_ACCESS_TOKEN=your-access-token
THREADS_USER_ID=your-user-id
```

Get these from [Meta Developer Console](https://developers.facebook.com) (create an app, add "Threads API" product, generate a token).

The system auto-seeds credentials into the database on first startup.

## Project structure

```
packages/
  shared/     — Types, Threads API client, encryption, SQLite schema, KV store
  api/        — Express REST API (port 3008)
  workers/    — Background jobs via node-cron (port 8080)
  dashboard/  — React + Vite frontend (port 5173)
```

## Architecture

- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — auto-created at `./threadsponder.db`
- **Job queue**: node-cron (no Redis/BullMQ)
- **State**: In-memory Map with TTL (OAuth CSRF tokens, rate limiting, job locks)
- **AI**: OpenRouter for classification + response generation
- **Encryption**: AES-256-GCM for Threads tokens at rest

## Features

- **Reply monitoring** — Auto-detect and respond to replies on focused posts
- **Voice training** — Teach the bot your tone with examples and document uploads
- **Voice settings** — Tune formality, brevity, aggression, emoji usage
- **Friends list** — Set banter/roast modes for specific usernames
- **Scheduled posts** — Queue posts for future publishing
- **Analytics** — Reply history, daily activity charts, classification breakdowns
- **Post metrics** — Track views, likes, replies, quotes over time
- **Banned phrases** — Prevent the bot from using specific words/phrases

## Commands

```bash
pnpm install       # Install dependencies
pnpm build         # Build all packages
pnpm dev           # Run all packages in dev mode
pnpm typecheck     # Type-check all packages
pnpm clean         # Clean build artifacts
```

## Database

SQLite schema is auto-created on first run. Key tables:

| Table | Purpose |
|---|---|
| `accounts` | User accounts |
| `threads_accounts` | Connected Threads accounts (encrypted tokens) |
| `focused_posts` | Posts being monitored for replies |
| `reply_history` | All processed replies + responses |
| `voice_examples` | Voice training examples with embeddings |
| `voice_settings` | Per-account voice configuration |
| `friends` | Friends list with banter/roast modes |
| `banned_phrases` | Words the bot should never use |
| `scheduled_posts` | Posts queued for future publishing |
| `post_metrics` | Engagement snapshots over time |

## Optional environment variables

| Variable | Purpose |
|---|---|
| `SQLITE_DB_PATH` | Database file path (default: `./threadsponder.db`) |
| `Z_AI_API_KEY` | Faster classification via GLM-4.7 |
| `RESEND_API_KEY` | Email notifications |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | OAuth flow (alternative to manual token) |

## License

MIT
