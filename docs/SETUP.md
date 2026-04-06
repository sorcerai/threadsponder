# Threadsponder Setup Guide

Personal setup for running Threadsponder locally as your own Threads auto-reply bot.

## What You Need

| Service | Purpose | Free Tier? |
|---------|---------|-----------|
| [Supabase](https://supabase.com) | PostgreSQL database + file storage | Yes |
| [Upstash](https://upstash.com) | Redis for job queue | Yes |
| [OpenRouter](https://openrouter.ai) | AI for classification + response generation | Pay per use |
| Node.js 18+ | Runtime | - |
| pnpm 9+ | Package manager | - |

**Optional:**
| Service | Purpose |
|---------|---------|
| [Z.AI](https://z.ai) | Faster reply classification (GLM-4.7) |
| Stripe | If you want billing/subscription features |
| Clerk | If you want multi-user auth (SaaS mode) |

## 1. Clone and Install

```bash
git clone <repo-url> threadsponder
cd threadsponder
pnpm install
```

## 2. Set Up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** — copy your **Project URL**, **anon key**, and **service_role key**
3. Enable pgvector in the **SQL Editor**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
4. Run all 18 migrations (in order):
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```
   Or paste each file from `supabase/migrations/` into the SQL Editor manually.

## 3. Set Up Upstash Redis

1. Create a Redis database at [upstash.com](https://upstash.com)
2. Copy the **Redis URL** (TCP format: `redis://default:PASSWORD@ENDPOINT:6379`)
3. Also copy the **REST URL** and **REST Token** from the dashboard

## 4. Get an OpenRouter API Key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Create an API key
3. Add some credits (classification + response generation costs ~$0.001-0.01 per reply)

## 5. Generate Encryption Key

For encrypting your Threads API tokens at rest:
```bash
openssl rand -base64 32
```

## 6. Create .env File

```bash
cp .env.example .env
```

Fill in the required values:
```env
# Required
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
UPSTASH_REDIS_URL=redis://default:PASSWORD@ENDPOINT.upstash.io:6379
UPSTASH_REDIS_REST_URL=https://ENDPOINT.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-rest-token
OPENROUTER_API_KEY=sk-or-v1-...
CREDENTIAL_ENCRYPTION_KEY=your-32-byte-base64-key

# App config
PORT=3008
NODE_ENV=development
DEFAULT_ORG_ID=default
DASHBOARD_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173
APP_URL=http://localhost:3008

# Optional — faster classification
Z_AI_API_KEY=...
```

## 7. Build and Run

```bash
pnpm build
pnpm dev
```

This starts:
- **API** on `http://localhost:3008`
- **Workers** (background jobs + health server)
- **Dashboard** on `http://localhost:5173`

Verify: `curl http://localhost:3008/health` should return `{"status":"ok",...}`

## 8. Connect Your Threads Account

Add your Threads credentials to `.env`:
```env
THREADS_ACCESS_TOKEN=your-access-token
THREADS_USER_ID=your-threads-user-id
THREADS_USERNAME=your-username
```

The system auto-seeds these into the database on first startup. Get your token from the [Meta Developer Console](https://developers.facebook.com) — create an app, add "Threads API", and generate a token via the API Explorer.

## 9. Start Monitoring

Once your Threads account is connected:

1. **Add focused posts** — these are the posts whose replies get monitored
   - Via dashboard or `POST /api/posts/focused`
2. **Add voice examples** — train how your bot responds
   - Via dashboard or `POST /api/voice/examples`
   - Or upload a document (`.txt`, `.md`, `.pdf`, `.docx`) for bulk training
3. The reply monitor runs automatically every minute

## Troubleshooting

**"No tenants scheduled"** — No account has connected Threads credentials yet. Complete step 8.

**Redis connection errors** — Make sure `UPSTASH_REDIS_URL` is the TCP URL (starts with `redis://`), not the REST URL.

**Migration errors** — Run `CREATE EXTENSION IF NOT EXISTS vector;` before the migrations. If one fails, check the SQL Editor for the specific error and run remaining migrations manually.

**Workers crash on startup** — Check that all required env vars are set. The workers need `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `UPSTASH_REDIS_URL`, and `OPENROUTER_API_KEY`.
