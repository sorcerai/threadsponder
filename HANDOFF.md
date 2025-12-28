# Threadsponder SaaS Platform - Handoff Document

**Last Updated**: December 2024
**Status**: Core infrastructure complete, ready for dashboard UI and deployment

## Project Overview

Threadsponder is a multi-tenant SaaS platform that converts the single-tenant eliza-threads AI reply bot into a subscription-based service. Users can:

- **Train their brand voice** with uploaded documents and writing samples
- **Auto-reply to Threads comments** using AI with their trained voice
- **Schedule posts** for future publishing
- **Manage friends** with special banter/roast modes
- **Monitor analytics** of their reply performance

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          MONOREPO                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  packages/                                                      │
│  ├── api/          Express API server (Clerk auth, REST)       │
│  ├── workers/      BullMQ jobs (reply monitor, scheduler)      │
│  ├── dashboard/    Next.js frontend (skeleton only)            │
│  └── shared/       Shared types, ThreadsClient                 │
│                                                                 │
│  supabase/                                                      │
│  └── migrations/   7 SQL migration files (schema complete)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User → Dashboard (Next.js) → API (Express) → Supabase (Postgres)
                                         ↘
                                          → Workers (BullMQ/Redis)
                                             ├── Reply Monitor
                                             ├── Post Scheduler
                                             └── Voice Processor
```

---

## What's Implemented ✅

### Phase 0: Repository Scaffolding
- [x] Turborepo monorepo with pnpm workspaces
- [x] TypeScript configuration across all packages
- [x] Package structure (api, workers, dashboard, shared)

### Phase 1: Core Multi-Tenancy
- [x] Database schema (7 migrations):
  - `001_accounts.sql` - Core accounts with Clerk integration
  - `002_threads_accounts.sql` - Threads API connections (encrypted tokens)
  - `003_voice.sql` - Voice examples (pgvector 1024-dim), settings, documents
  - `004_posts.sql` - Focused posts, scheduled posts
  - `005_friends.sql` - Friends list with banter/roast modes
  - `006_history.sql` - Reply history for analytics
  - `007_functions.sql` - pgvector search, analytics functions
- [x] Row Level Security (RLS) policies for all tables
- [x] Tenant service (`packages/workers/src/services/tenant.ts`)
- [x] Token encryption/decryption (AES-256-CBC)
- [x] Reply monitor job (`packages/workers/src/jobs/reply-monitor.ts`)

### Phase 2: Voice Training System
- [x] Embeddings service (`packages/workers/src/services/embeddings.ts`)
  - OpenRouter text-embedding-3-large (1024 dimensions)
  - Text chunking with overlap
  - Auto tone classification
- [x] Voice processor job (`packages/workers/src/jobs/voice-processor.ts`)
  - Document upload → chunk → embed → store pipeline
  - Supabase Storage integration
- [x] Classifier (`packages/workers/src/utils/classifier.ts`)
  - OpenRouter-based classification (friendly/neutral/hostile/skip)
  - Injection detection
- [x] Responder (`packages/workers/src/utils/responder.ts`)
  - Voice style matching (energy, formality, brevity, emoji, slang)
  - Friend detection with banter/roast modes
  - Response length calibration by tone

### Phase 3: API Routes
- [x] Auth middleware (`packages/api/src/middleware/auth.ts`)
  - Clerk JWT validation
  - Auto-create accounts for new users
- [x] Threads routes (`/api/threads/*`)
  - Connect/disconnect accounts
  - Token paste with encryption
- [x] Voice routes (`/api/voice/*`)
  - Examples CRUD
  - Settings management
  - Document uploads
  - Test drive endpoint
- [x] Posts routes (`/api/posts/*`)
  - Focused posts CRUD
  - Scheduled posts CRUD
- [x] Friends routes (`/api/friends/*`)
  - Full CRUD with mode toggle
- [x] Analytics routes (`/api/analytics/*`)
  - Overview metrics
  - Reply history with pagination
  - Daily activity charts
  - Performance metrics

### Phase 4: Post Scheduler
- [x] Post scheduler job (`packages/workers/src/jobs/post-scheduler.ts`)
- [x] Cron scheduling in worker entry point

### Phase 5: Billing (Stripe)
- [x] Billing routes (`/api/billing/*`)
  - Status endpoint
  - Trial checkout ($1 for 3 days)
  - Subscription checkout ($14.99/mo)
  - Customer portal redirect
  - Webhook handlers for all payment events

---

## What's Pending ⏳

### Dashboard UI (packages/dashboard)
The Next.js dashboard is a **skeleton only**. Needs:

1. **Auth pages**: `/login`, `/signup` (Clerk components)
2. **Dashboard layout**: Sidebar navigation
3. **Overview page**: Metrics cards, activity chart
4. **Voice training page**:
   - Voice examples list
   - Fine-tuning sliders (formality, brevity, emoji, aggression)
   - Document uploader
   - Test drive modal
5. **Posts page**:
   - Focused posts management
   - Scheduled posts calendar view
6. **Friends page**: Friends list with mode toggle
7. **Analytics page**: Reply history table, charts
8. **Settings pages**: Account, billing, Threads connections

### Deployment
- [ ] Docker files for API and Workers
- [ ] Railway/Fly.io deployment configs
- [ ] Cloudflare Pages config for dashboard
- [ ] Environment variable documentation

### Integration Testing
- [ ] End-to-end flow testing
- [ ] Webhook signature verification testing
- [ ] Multi-tenant isolation validation

---

## Environment Variables

### API Server (packages/api)
```env
# Server
PORT=3001
NODE_ENV=development

# Clerk Auth
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJh...

# Encryption
ENCRYPTION_KEY=<64-char-hex-string>  # openssl rand -hex 32

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...        # Monthly subscription price
STRIPE_TRIAL_PRICE_ID=price_...  # $1 trial price

# App
APP_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000,https://threadsponder.com
```

### Workers (packages/workers)
```env
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJh...

# Redis (Upstash)
UPSTASH_REDIS_URL=redis://default:xxx@xxx.upstash.io:6379

# OpenRouter (for LLM calls)
OPENROUTER_API_KEY=sk-or-v1-...

# Encryption (same as API)
ENCRYPTION_KEY=<64-char-hex-string>
```

### Dashboard (packages/dashboard)
```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...

# API
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Running the Project

### Prerequisites
- Node.js 18+
- pnpm 8+
- Supabase project with pgvector extension
- Upstash Redis instance
- Clerk account
- Stripe account (test mode)
- OpenRouter API key

### Local Development

```bash
cd /Users/ariapramesi/repos/threadsponder

# Install dependencies
pnpm install

# Run migrations on Supabase
# (Use Supabase CLI or paste SQL in dashboard)

# Start all services (from root)
pnpm dev

# Or individually:
cd packages/api && pnpm dev     # API on :3001
cd packages/workers && pnpm dev  # Workers
cd packages/dashboard && pnpm dev # Dashboard on :3000
```

### Database Setup

1. Create Supabase project at supabase.com
2. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Run migrations in order (001-007) in SQL editor

---

## Key Files Reference

### Shared Types
`packages/shared/src/types/index.ts` - All database and API types

### ThreadsClient
`packages/shared/src/clients/threads.ts` - Threads API client (accepts credentials via constructor)

### Core Services
- `packages/workers/src/services/tenant.ts` - Multi-tenant config loading
- `packages/workers/src/services/embeddings.ts` - OpenRouter embeddings

### Background Jobs
- `packages/workers/src/jobs/reply-monitor.ts` - Per-tenant reply monitoring
- `packages/workers/src/jobs/post-scheduler.ts` - Scheduled post publishing
- `packages/workers/src/jobs/voice-processor.ts` - Document processing

### AI Logic
- `packages/workers/src/utils/classifier.ts` - Reply classification
- `packages/workers/src/utils/responder.ts` - Voice-matched responses

### API Routes
All in `packages/api/src/routes/`:
- `threads.ts` - Threads account management
- `voice.ts` - Voice training
- `posts.ts` - Focused and scheduled posts
- `friends.ts` - Friends list
- `analytics.ts` - Metrics and history
- `billing.ts` - Stripe integration

---

## Ported from eliza-threads

These files were adapted from `/Users/ariapramesi/repos/eliza-threads/agent/`:

| Original | Threadsponder Location | Changes |
|----------|----------------------|---------|
| `src/clients/threads-direct-client.ts` | `packages/shared/src/clients/threads.ts` | Accepts credentials via constructor instead of env |
| `src/utils/smart-responder.ts` | `packages/workers/src/utils/responder.ts` | Multi-tenant voice loading, Supabase integration |
| `src/utils/fast-classifier.ts` | `packages/workers/src/utils/classifier.ts` | OpenRouter instead of Z.AI |
| Voice provider patterns | `packages/workers/src/services/embeddings.ts` | pgvector instead of DragonflyDB |

---

## Pricing Model

- **$1 Trial**: 3-day access to all features
- **$14.99/mo**: Full subscription

Stripe product/price IDs need to be configured in the dashboard.

---

## Next Steps for Agent

1. **Create Dashboard UI**: Build the Next.js pages listed above using:
   - Clerk for auth (`@clerk/nextjs`)
   - shadcn/ui for components
   - TanStack Query for data fetching
   - Recharts for analytics charts

2. **Test the full flow**:
   - Sign up with Clerk
   - Connect Threads account (paste token)
   - Add voice examples
   - Add focused posts
   - Verify reply monitoring works

3. **Deploy**:
   - Dashboard → Cloudflare Pages
   - API + Workers → Railway or backup server (Docker)
   - Configure production environment variables

4. **Return to eliza-threads**: The original bot at `/Users/ariapramesi/repos/eliza-threads` continues to run independently.

---

## Git Status

```
Branch: main (or feature/threadsponder-mvp)
Last Commit: Phase 1-5 implementation
```

All code is committed and ready for continued development.
