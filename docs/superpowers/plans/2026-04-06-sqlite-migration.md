# SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (PostgreSQL) + Upstash Redis + BullMQ with a single SQLite file and direct function calls — zero external services required to run Threadsponder.

**Architecture:** `better-sqlite3` provides the database (sync API, single file, no server). BullMQ queues are removed entirely — worker jobs are called directly from node-cron. Redis usage (oauthState, jobLock, rate limiting, stats) moves to SQLite tables or in-memory Maps. The existing 18 Supabase migrations are converted to SQLite-compatible SQL run at startup.

**Tech Stack:** `better-sqlite3`, `express-rate-limit` (in-memory), `node-cron` (already in use), TypeScript, Vitest

---

## Scope of changes

| Layer | Before | After |
|-------|--------|-------|
| Database | Supabase (PostgreSQL) + `@supabase/supabase-js` | `better-sqlite3` |
| Job queue | BullMQ + IORedis | Direct async calls from node-cron |
| Redis (cache/KV) | Upstash REST + `@upstash/redis` | In-memory Map with TTL |
| Rate limiting | `@upstash/ratelimit` | `express-rate-limit` memory store |
| OAuth state | Redis key with 5min TTL | In-memory Map with TTL cleanup |
| Embeddings | `pgvector` column | `TEXT` column (JSON array), cosine similarity in JS |

---

## File Map

**New files:**
- `packages/shared/src/db/sqlite.ts` — singleton `better-sqlite3` connection + schema init
- `packages/shared/src/db/schema.sql` — full SQLite schema (converted from 18 migrations)
- `packages/shared/src/utils/kv-store.ts` — in-memory Map KV with TTL (replaces upstash-client.ts)

**Modified files:**
- `packages/shared/src/utils/security-middleware.ts` — swap Upstash rate limiter → `express-rate-limit`
- `packages/shared/src/index.ts` — swap exports (remove upstash, add sqlite + kv-store)
- `packages/api/src/middleware/auth.ts` — Supabase → SQLite
- `packages/api/src/routes/auth.ts` — oauthState → in-memory KV
- `packages/api/src/routes/threads.ts` — Supabase → SQLite
- `packages/api/src/routes/posts.ts` — Supabase → SQLite
- `packages/api/src/routes/voice.ts` — Supabase + BullMQ → SQLite + direct call
- `packages/api/src/routes/stats.ts` — Redis → SQLite query
- `packages/api/src/routes/billing.ts` — Supabase → SQLite (Stripe webhook still works)
- `packages/api/src/routes/reports.ts` — Supabase → SQLite
- `packages/api/src/routes/finetune.ts` — Supabase + Redis → SQLite
- `packages/api/src/routes/analytics.ts` — Supabase → SQLite
- `packages/api/src/routes/friends.ts` — Supabase → SQLite
- `packages/workers/src/jobs/reply-monitor.ts` — remove BullMQ, export `runReplyMonitor(accountId)`
- `packages/workers/src/jobs/post-scheduler.ts` — remove BullMQ, export `runPostScheduler()`
- `packages/workers/src/jobs/voice-processor.ts` — remove BullMQ, export `runVoiceProcessor(docId)`
- `packages/workers/src/jobs/metrics-collector.ts` — remove BullMQ, export `runMetricsCollector(accountId)`
- `packages/workers/src/index.ts` — call jobs directly from cron, remove queue/worker exports
- `packages/workers/src/services/tenant.ts` — Supabase → SQLite
- `packages/api/vitest.config.ts` — remove Upstash env stubs
- `packages/api/src/__tests__/safety.e2e.test.ts` — update mocks

**Deleted files:**
- `packages/shared/src/utils/upstash-client.ts`
- `packages/shared/src/db/supabase.ts`

**Package.json changes (remove):**
- `packages/shared`: `@upstash/redis`, `@upstash/ratelimit`, `@supabase/supabase-js`
- `packages/api`: `@supabase/supabase-js`, `bullmq`, `ioredis`
- `packages/workers`: `bullmq`, `ioredis`, `@supabase/supabase-js`

**Package.json changes (add):**
- `packages/shared`: `better-sqlite3`, `@types/better-sqlite3`
- `packages/api`: `express-rate-limit`, `@types/express-rate-limit`

---

### Task 1: SQLite client + schema

**Files:**
- Create: `packages/shared/src/db/sqlite.ts`
- Create: `packages/shared/src/db/schema.sql`

- [ ] **Step 1: Install better-sqlite3**

```bash
pnpm add better-sqlite3 --filter @threadsponder/shared
pnpm add -D @types/better-sqlite3 --filter @threadsponder/shared
```

Expected: `packages/shared/package.json` updated.

- [ ] **Step 2: Write failing test**

Create `packages/shared/src/db/__tests__/sqlite.test.ts`:

```typescript
import { describe, test, expect, afterEach } from 'vitest';
import fs from 'fs';

const DB_PATH = '/tmp/threadsponder-test.db';

afterEach(() => {
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});

describe('SQLite client', () => {
  test('given a DB path, should open and initialise schema without throwing', async () => {
    process.env.SQLITE_DB_PATH = DB_PATH;
    const { getDb } = await import('../sqlite.js');
    const db = getDb();
    expect(db.open).toBe(true);
  });

  test('given schema init, accounts table should exist', async () => {
    process.env.SQLITE_DB_PATH = DB_PATH;
    const { getDb } = await import('../sqlite.js');
    const db = getDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();
    expect(row).toBeDefined();
  });
});
```

Run: `pnpm --filter @threadsponder/shared test`
Expected: FAIL — `../sqlite.js` does not exist.

- [ ] **Step 3: Write the SQLite schema**

Create `packages/shared/src/db/schema.sql`:

```sql
-- Core account (replaces accounts + clerk_user_id)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired')),
  subscription_ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Threads OAuth credentials (encrypted token at rest)
CREATE TABLE IF NOT EXISTS threads_accounts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_user_id TEXT NOT NULL,
  threads_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_user_id)
);

-- Voice training examples (embedding stored as JSON text)
CREATE TABLE IF NOT EXISTS voice_examples (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'neutral',
  embedding TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Voice settings
CREATE TABLE IF NOT EXISTS voice_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  formality INTEGER NOT NULL DEFAULT 5 CHECK (formality BETWEEN 1 AND 10),
  brevity INTEGER NOT NULL DEFAULT 5 CHECK (brevity BETWEEN 1 AND 10),
  aggression INTEGER NOT NULL DEFAULT 5 CHECK (aggression BETWEEN 1 AND 10),
  emoji_usage INTEGER NOT NULL DEFAULT 3 CHECK (emoji_usage BETWEEN 1 AND 10),
  custom_instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Posts being monitored for replies
CREATE TABLE IF NOT EXISTS focused_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  threads_post_id TEXT NOT NULL,
  post_text TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_post_id)
);

-- Scheduled posts queue
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_account_id TEXT NOT NULL REFERENCES threads_accounts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  media_urls TEXT DEFAULT '[]',
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'posted', 'failed', 'cancelled')),
  posted_id TEXT,
  error_message TEXT,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reply history (deduplication + analytics)
CREATE TABLE IF NOT EXISTS reply_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  focused_post_id TEXT NOT NULL REFERENCES focused_posts(id) ON DELETE CASCADE,
  threads_reply_id TEXT NOT NULL,
  replier_username TEXT NOT NULL,
  reply_text TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'neutral',
  confidence REAL NOT NULL DEFAULT 0.5,
  our_response TEXT,
  our_reply_id TEXT,
  replied INTEGER NOT NULL DEFAULT 0,
  hostile_words TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_reply_id)
);

-- Blocked users
CREATE TABLE IF NOT EXISTS blocked_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_username)
);

-- Friends (special reply mode: banter/roast)
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'banter' CHECK (mode IN ('banter', 'roast', 'normal')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, threads_username)
);

-- Per-user cooldowns (prevent reply spam to same person)
CREATE TABLE IF NOT EXISTS user_cooldowns (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  last_replied_at TEXT NOT NULL,
  UNIQUE(account_id, threads_username)
);

-- Bot loop tracking (detect reply chains that loop)
CREATE TABLE IF NOT EXISTS bot_loop_rates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  threads_username TEXT NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  UNIQUE(account_id, threads_username)
);

-- Post performance metrics
CREATE TABLE IF NOT EXISTS post_metrics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  focused_post_id TEXT NOT NULL REFERENCES focused_posts(id) ON DELETE CASCADE,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  replies INTEGER DEFAULT 0,
  quotes INTEGER DEFAULT 0,
  reposts INTEGER DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Banned phrases (never say these in responses)
CREATE TABLE IF NOT EXISTS banned_phrases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, phrase)
);

-- Ammunition (pre-written comebacks/responses)
CREATE TABLE IF NOT EXISTS ammunition (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Usage events (lightweight analytics)
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_threads_accounts_account ON threads_accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_focused_posts_account ON focused_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_focused_posts_active ON focused_posts(account_id, is_active);
CREATE INDEX IF NOT EXISTS idx_reply_history_post ON reply_history(focused_post_id);
CREATE INDEX IF NOT EXISTS idx_reply_history_account_date ON reply_history(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_due ON scheduled_posts(scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_voice_examples_account ON voice_examples(account_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_account ON usage_events(account_id, created_at);
```

- [ ] **Step 4: Write the SQLite client**

Create `packages/shared/src/db/sqlite.ts`:

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'threadsponder.db');

  _db = new Database(dbPath);

  // Performance settings
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');

  // Run schema on first open
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  _db.exec(schema);

  return _db;
}

// For testing — reset singleton
export function _resetDb(): void {
  if (_db) { _db.close(); _db = null; }
}
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
pnpm --filter @threadsponder/shared build
pnpm --filter @threadsponder/shared test
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/db/sqlite.ts packages/shared/src/db/schema.sql packages/shared/src/db/__tests__/sqlite.test.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat: add SQLite client + schema (replaces Supabase)"
```

---

### Task 2: In-memory KV store (replaces Upstash Redis)

**Files:**
- Create: `packages/shared/src/utils/kv-store.ts`

Redis is used for: oauthState (5min TTL), jobLock (10min TTL), tenantCache (1hr TTL), streak counter. For single-process local use, an in-memory Map with TTL is sufficient and requires no dependencies.

- [ ] **Step 1: Write failing test**

Create `packages/shared/src/utils/__tests__/kv-store.test.ts`:

```typescript
import { describe, test, expect, vi, afterEach } from 'vitest';
import { kvStore } from '../kv-store.js';

afterEach(() => kvStore.clear());

describe('kvStore', () => {
  test('given a set key, get should return the value', () => {
    kvStore.set('foo', 'bar', 60);
    expect(kvStore.get('foo')).toBe('bar');
  });

  test('given an expired key, get should return null', () => {
    vi.useFakeTimers();
    kvStore.set('foo', 'bar', 1); // 1 second TTL
    vi.advanceTimersByTime(1001);
    expect(kvStore.get('foo')).toBeNull();
    vi.useRealTimers();
  });

  test('given del, get should return null', () => {
    kvStore.set('foo', 'bar', 60);
    kvStore.del('foo');
    expect(kvStore.get('foo')).toBeNull();
  });

  test('given setNx on existing key, should return false and not overwrite', () => {
    kvStore.set('lock', 'first', 60);
    const acquired = kvStore.setNx('lock', 'second', 60);
    expect(acquired).toBe(false);
    expect(kvStore.get('lock')).toBe('first');
  });

  test('given setNx on missing key, should return true', () => {
    const acquired = kvStore.setNx('lock', 'owner', 60);
    expect(acquired).toBe(true);
    expect(kvStore.get('lock')).toBe('owner');
  });
});
```

Run: `pnpm --filter @threadsponder/shared test`
Expected: FAIL — `kv-store.js` not found.

- [ ] **Step 2: Implement kv-store**

Create `packages/shared/src/utils/kv-store.ts`:

```typescript
/**
 * In-memory KV store with TTL.
 * Replaces Upstash Redis for single-process local use.
 * Not suitable for multi-process/distributed deployments.
 */

interface Entry<T> {
  value: T;
  expiresAt: number; // unix ms
}

class KvStore {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Set only if key does not exist. Returns true if set, false if already present. */
  setNx<T>(key: string, value: T, ttlSeconds: number): boolean {
    if (this.get(key) !== null) return false;
    this.set(key, value, ttlSeconds);
    return true;
  }

  del(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const kvStore = new KvStore();

/** OAuth CSRF state — 5 minute TTL, one-time use */
export const oauthState = {
  set(token: string, orgId: string): void {
    kvStore.set(`oauth:state:${token}`, orgId, 300);
  },
  validate(token: string): string | null {
    const key = `oauth:state:${token}`;
    const orgId = kvStore.get<string>(key);
    if (orgId) kvStore.del(key); // consume
    return orgId;
  },
};

/** Job deduplication lock — 10 minute TTL */
export const jobLock = {
  acquire(jobId: string, ttlSeconds = 600): boolean {
    return kvStore.setNx(`lock:job:${jobId}`, '1', ttlSeconds);
  },
  release(jobId: string): void {
    kvStore.del(`lock:job:${jobId}`);
  },
  isLocked(jobId: string): boolean {
    return kvStore.get(`lock:job:${jobId}`) !== null;
  },
};
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @threadsponder/shared test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/utils/kv-store.ts packages/shared/src/utils/__tests__/kv-store.test.ts
git commit -m "feat: add in-memory KV store with TTL (replaces Upstash Redis)"
```

---

### Task 3: Replace rate limiter in security-middleware

**Files:**
- Modify: `packages/shared/src/utils/security-middleware.ts`

- [ ] **Step 1: Install express-rate-limit in shared**

```bash
pnpm add express-rate-limit --filter @threadsponder/shared
```

- [ ] **Step 2: Replace the rate limiter**

In `packages/shared/src/utils/security-middleware.ts`, replace the Upstash import and `createApiRateLimiter`:

Remove:
```typescript
import { createUpstashRateLimiter } from './upstash-client.js';
```

Add at top:
```typescript
import rateLimit from 'express-rate-limit';
```

Find and replace `createApiRateLimiter` (it currently calls `createUpstashRateLimiter`). Replace the entire function:

```typescript
/**
 * API rate limiter — 100 requests per minute per IP.
 * In-memory store: suitable for single-process deployments.
 */
export function createApiRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
}
```

- [ ] **Step 3: Build and verify no type errors**

```bash
pnpm --filter @threadsponder/shared build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/utils/security-middleware.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat: replace Upstash rate limiter with express-rate-limit"
```

---

### Task 4: Update shared/index.ts exports

**Files:**
- Modify: `packages/shared/src/index.ts`
- Delete: `packages/shared/src/utils/upstash-client.ts`
- Delete: `packages/shared/src/db/supabase.ts`

- [ ] **Step 1: Update index.ts**

Replace `packages/shared/src/index.ts` with:

```typescript
// Shared types and utilities for Threadsponder

export * from './types/index.js';

// SQLite client (replaces Supabase)
export * from './db/sqlite.js';

// Threads API client
export * from './clients/threads.js';

// Security utilities
export * from './utils/credential-encryption.js';
export * from './utils/safe-logger.js';
export * from './utils/redis-sanitize.js';
export * from './utils/security-middleware.js';

// In-memory KV store (replaces Upstash Redis)
export * from './utils/kv-store.js';
```

- [ ] **Step 2: Delete the old files**

```bash
rm packages/shared/src/utils/upstash-client.ts
rm packages/shared/src/db/supabase.ts
```

- [ ] **Step 3: Remove Upstash/Supabase deps from shared**

```bash
pnpm remove @upstash/redis @upstash/ratelimit @supabase/supabase-js --filter @threadsponder/shared
```

- [ ] **Step 4: Build**

```bash
pnpm --filter @threadsponder/shared build
```

Fix any import errors. Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/package.json pnpm-lock.yaml
git rm packages/shared/src/utils/upstash-client.ts packages/shared/src/db/supabase.ts
git commit -m "chore: remove Upstash and Supabase from shared package"
```

---

### Task 5: Remove BullMQ from workers — reply-monitor

**Files:**
- Modify: `packages/workers/src/jobs/reply-monitor.ts`

The goal: remove the Queue/Worker/IORedis boilerplate and export a plain `runReplyMonitor(accountId, threadsAccountId)` async function. The cron in `index.ts` will call it directly.

- [ ] **Step 1: Remove BullMQ infrastructure from reply-monitor.ts**

At the top of `packages/workers/src/jobs/reply-monitor.ts`, remove:
```typescript
import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
```
And remove:
```typescript
const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
export const replyMonitorQueue = new Queue<MonitorJobData>('reply-monitor', { connection });
```
And the `Worker` instantiation block.

- [ ] **Step 2: Replace Supabase with SQLite**

Remove:
```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';
```

Add:
```typescript
import { getDb } from '@threadsponder/shared';
```

Replace all `supabase.from(...)` calls with `better-sqlite3` prepared statements. Example pattern:

```typescript
// Before (Supabase)
const { data, error } = await supabase
  .from('focused_posts')
  .select('*')
  .eq('account_id', accountId)
  .eq('is_active', true);

// After (SQLite)
const db = getDb();
const posts = db.prepare(
  'SELECT * FROM focused_posts WHERE account_id = ? AND is_active = 1'
).all(accountId);
```

- [ ] **Step 3: Export plain function**

At the bottom of the file, export:

```typescript
/**
 * Run the reply monitor for one account.
 * Called directly by node-cron — no queue needed.
 */
export async function runReplyMonitor(
  accountId: string,
  threadsAccountId: string
): Promise<void> {
  // move the job processor function body here
}
```

Remove the old `replyMonitorWorker` export and `replyMonitorQueue` export.

Also export `scheduleMonitoringJobs` which fetches active accounts and calls `runReplyMonitor` for each:

```typescript
export async function scheduleMonitoringJobs(): Promise<void> {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT a.id as account_id, ta.id as threads_account_id
    FROM accounts a
    JOIN threads_accounts ta ON ta.account_id = a.id
    WHERE ta.is_active = 1
  `).all() as { account_id: string; threads_account_id: string }[];

  await Promise.allSettled(
    accounts.map(({ account_id, threads_account_id }) =>
      runReplyMonitor(account_id, threads_account_id)
    )
  );
}
```

- [ ] **Step 4: Build workers package**

```bash
pnpm --filter @threadsponder/workers build
```

Fix type errors. Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/jobs/reply-monitor.ts
git commit -m "feat: remove BullMQ from reply-monitor, direct async calls"
```

---

### Task 6: Remove BullMQ from workers — post-scheduler, voice-processor, metrics-collector

**Files:**
- Modify: `packages/workers/src/jobs/post-scheduler.ts`
- Modify: `packages/workers/src/jobs/voice-processor.ts`
- Modify: `packages/workers/src/jobs/metrics-collector.ts`

Apply the same pattern as Task 5 to each:

- [ ] **Step 1: post-scheduler.ts**

Remove BullMQ imports + IORedis. Remove `postSchedulerQueue` / `postSchedulerWorker`.
Replace Supabase with SQLite (`getDb()`).

Export:
```typescript
export async function runPostScheduler(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const posts = db.prepare(`
    SELECT * FROM scheduled_posts
    WHERE status = 'pending' AND scheduled_for <= ?
  `).all(now) as any[];

  await Promise.allSettled(posts.map(post => publishPost(post)));
}
```

Keep `scheduleDuePosts` as an alias: `export const scheduleDuePosts = runPostScheduler;`

- [ ] **Step 2: voice-processor.ts**

Remove BullMQ imports + IORedis. Remove `voiceProcessorQueue` / `voiceProcessorWorker`.
Replace Supabase with SQLite. Embeddings: store as `JSON.stringify(embedding)` in the `embedding TEXT` column.

Export:
```typescript
export async function runVoiceProcessor(documentId: string): Promise<void> {
  // existing processing logic, using getDb() for DB access
}
```

- [ ] **Step 3: metrics-collector.ts**

Remove BullMQ imports + IORedis. Remove `metricsCollectorQueue` / `metricsCollectorWorker`.
Replace Supabase with SQLite.

Export:
```typescript
export async function runMetricsCollector(
  accountId: string,
  threadsAccountId: string
): Promise<void> { ... }

export async function scheduleMetricsJobs(): Promise<void> {
  const db = getDb();
  const accounts = db.prepare(`
    SELECT a.id as account_id, ta.id as threads_account_id
    FROM accounts a JOIN threads_accounts ta ON ta.account_id = a.id
    WHERE ta.is_active = 1
  `).all() as { account_id: string; threads_account_id: string }[];

  await Promise.allSettled(
    accounts.map(({ account_id, threads_account_id }) =>
      runMetricsCollector(account_id, threads_account_id)
    )
  );
}
```

- [ ] **Step 4: Build**

```bash
pnpm --filter @threadsponder/workers build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/jobs/post-scheduler.ts packages/workers/src/jobs/voice-processor.ts packages/workers/src/jobs/metrics-collector.ts
git commit -m "feat: remove BullMQ from post-scheduler, voice-processor, metrics-collector"
```

---

### Task 7: Simplify workers/index.ts

**Files:**
- Modify: `packages/workers/src/index.ts`

- [ ] **Step 1: Replace with direct calls**

Replace `packages/workers/src/index.ts` entirely:

```typescript
import cron from 'node-cron';
import http from 'http';
import { scheduleMonitoringJobs } from './jobs/reply-monitor.js';
import { runPostScheduler } from './jobs/post-scheduler.js';
import { scheduleMetricsJobs } from './jobs/metrics-collector.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(PORT, () => {
  console.log(`[Workers] Health server on :${PORT}`);
});

cron.schedule('* * * * *', async () => {
  try { await scheduleMonitoringJobs(); }
  catch (e) { console.error('[Cron] reply-monitor:', e); }
});

cron.schedule('* * * * *', async () => {
  try { await runPostScheduler(); }
  catch (e) { console.error('[Cron] post-scheduler:', e); }
});

cron.schedule('*/5 * * * *', async () => {
  try { await scheduleMetricsJobs(); }
  catch (e) { console.error('[Cron] metrics:', e); }
});

console.log('[Workers] Started — cron running');

process.on('SIGTERM', () => { healthServer.close(); process.exit(0); });
process.on('SIGINT',  () => { healthServer.close(); process.exit(0); });
```

- [ ] **Step 2: Remove BullMQ from workers package.json**

```bash
pnpm remove bullmq ioredis @supabase/supabase-js --filter @threadsponder/workers
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @threadsponder/workers build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/workers/src/index.ts packages/workers/package.json pnpm-lock.yaml
git commit -m "feat: simplify workers — direct cron calls, no BullMQ"
```

---

### Task 8: Replace Supabase in API — auth middleware + auth routes

**Files:**
- Modify: `packages/api/src/middleware/auth.ts`
- Modify: `packages/api/src/routes/auth.ts`

- [ ] **Step 1: Update auth.ts middleware**

Replace `@supabase/supabase-js` import with `getDb` from `@threadsponder/shared`.

Replace the `getOrCreateAccount()` function:

```typescript
import { getDb, encryptCredential } from '@threadsponder/shared';

async function getOrCreateAccount(): Promise<string | null> {
  if (_cachedAccountId) return _cachedAccountId;

  const db = getDb();
  const userId = process.env.DEFAULT_ORG_ID || 'standalone';

  let account = db.prepare(
    'SELECT id FROM accounts WHERE user_id = ?'
  ).get(userId) as { id: string } | undefined;

  if (!account) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO accounts (id, user_id, name, email, subscription_status)
      VALUES (?, ?, ?, ?, 'active')
    `).run(id, userId, 'Standalone User', `${userId}@localhost`);
    account = { id };

    console.log(`[Auth] Created standalone account: ${id}`);
    seedThreadsCredentials(id);
  }

  _cachedAccountId = account.id;
  return account.id;
}
```

Replace `seedThreadsCredentials`:

```typescript
function seedThreadsCredentials(accountId: string): void {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;
  if (!accessToken || !threadsUserId) return;

  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM threads_accounts WHERE account_id = ? AND threads_user_id = ?'
  ).get(accountId, threadsUserId);
  if (existing) return;

  const encrypted = encryptCredential(accessToken) ?? accessToken;
  db.prepare(`
    INSERT OR IGNORE INTO threads_accounts
      (id, account_id, threads_user_id, threads_username, access_token_encrypted, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(crypto.randomUUID(), accountId, threadsUserId, process.env.THREADS_USERNAME ?? null, encrypted);

  console.log(`[Auth] Seeded Threads credentials for ${threadsUserId}`);
}
```

- [ ] **Step 2: Update routes/auth.ts**

Replace `oauthState` import (was from `@threadsponder/shared` → upstash-client). Now it comes from `kv-store.ts` which is still exported from `@threadsponder/shared`. No import change needed — the export path is the same.

Remove `@supabase/supabase-js` import, replace `getSupabase()` + upsert with SQLite:

```typescript
import { getDb, oauthState, encryptCredential } from '@threadsponder/shared';

// Replace the upsert in the callback handler:
const db = getDb();
db.prepare(`
  INSERT INTO threads_accounts
    (id, account_id, threads_user_id, access_token_encrypted, is_active)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(account_id, threads_user_id) DO UPDATE SET
    access_token_encrypted = excluded.access_token_encrypted,
    updated_at = datetime('now')
`).run(crypto.randomUUID(), orgId, String(user_id), encryptedToken);
```

- [ ] **Step 3: Build API package**

```bash
pnpm --filter @threadsponder/api build
```

Fix type errors. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/middleware/auth.ts packages/api/src/routes/auth.ts
git commit -m "feat: replace Supabase with SQLite in auth middleware and auth routes"
```

---

### Task 9: Replace Supabase in remaining API routes

**Files:**
- Modify: `packages/api/src/routes/threads.ts`
- Modify: `packages/api/src/routes/posts.ts`
- Modify: `packages/api/src/routes/voice.ts`
- Modify: `packages/api/src/routes/stats.ts`
- Modify: `packages/api/src/routes/billing.ts`
- Modify: `packages/api/src/routes/reports.ts`
- Modify: `packages/api/src/routes/finetune.ts`
- Modify: `packages/api/src/routes/analytics.ts`
- Modify: `packages/api/src/routes/friends.ts`

Apply the same migration pattern: remove `@supabase/supabase-js` + `createClient`, import `getDb` from `@threadsponder/shared`, replace every `.from(table).select/insert/update/delete` chain with a SQLite prepared statement.

**Reference patterns:**

```typescript
// SELECT one row
const row = db.prepare('SELECT * FROM table WHERE id = ?').get(id);

// SELECT many rows
const rows = db.prepare('SELECT * FROM table WHERE account_id = ?').all(accountId);

// INSERT
db.prepare('INSERT INTO table (id, col1, col2) VALUES (?, ?, ?)').run(crypto.randomUUID(), val1, val2);

// UPDATE
db.prepare('UPDATE table SET col = ?, updated_at = datetime(\'now\') WHERE id = ?').run(val, id);

// DELETE
db.prepare('DELETE FROM table WHERE id = ? AND account_id = ?').run(id, accountId);
```

**Special: stats.ts** — was reading from Redis hash maps. Replace with SQLite query on `reply_history`:

```typescript
// GET /api/stats/achievements
const db = getDb();
const orgId = getOrgId(req);
const today = new Date().toISOString().split('T')[0];

const allTime = db.prepare(`
  SELECT COUNT(*) as count FROM reply_history WHERE account_id = ?
`).get(orgId) as { count: number };

const todayRows = db.prepare(`
  SELECT COUNT(*) as count FROM reply_history
  WHERE account_id = ? AND date(created_at) = ?
`).get(orgId, today) as { count: number };
```

**Special: voice.ts** — remove BullMQ queue. When a document is uploaded, call `runVoiceProcessor(docId)` directly (or as a background promise — `runVoiceProcessor(docId).catch(console.error)`).

Remove:
```typescript
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
```
Add:
```typescript
import { runVoiceProcessor } from '../../workers/jobs/voice-processor.js';
// or trigger via API call if worker is a separate process
```

> **Note:** If API and workers run as separate processes, voice processing should be triggered via a `voice_processing_queue` SQLite table that workers poll every minute — add a row on upload, workers pick it up. See the schema addition below.

Add to `schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS voice_processing_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  account_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 1: Migrate each route file** (do them one at a time, build after each)

For each file:
1. Remove Supabase import
2. Add `import { getDb } from '@threadsponder/shared';`
3. Replace every Supabase chain with SQLite prepared statements
4. Run `pnpm --filter @threadsponder/api build` — fix errors

- [ ] **Step 2: Remove BullMQ from API package**

```bash
pnpm remove bullmq ioredis @supabase/supabase-js --filter @threadsponder/api
```

- [ ] **Step 3: Build**

```bash
pnpm --filter @threadsponder/api build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/
git commit -m "feat: replace Supabase with SQLite in all API routes"
```

---

### Task 10: Update tests + vitest config

**Files:**
- Modify: `packages/api/vitest.config.ts`
- Modify: `packages/api/src/__tests__/setup.ts`
- Modify: `packages/api/src/__tests__/safety.e2e.test.ts`

- [ ] **Step 1: Update vitest.config.ts**

Remove Upstash env vars. Add SQLite DB path:

```typescript
env: {
  SQLITE_DB_PATH: '/tmp/threadsponder-test.db',
  CREDENTIAL_ENCRYPTION_KEY: Buffer.from('test-encryption-key-32bytes!!!!!').toString('base64'),
  DEFAULT_ORG_ID: 'test-org',
  NODE_ENV: 'test',
},
```

- [ ] **Step 2: Update safety test mocks**

The `@supabase/supabase-js` mock is no longer needed. The `@threadsponder/shared` mock for `oauthState` now points to `kv-store.ts` — same mock shape, no change needed.

Remove the `vi.mock('@supabase/supabase-js', ...)` block. Add SQLite test isolation:

```typescript
import { _resetDb } from '@threadsponder/shared';
import { afterEach } from 'vitest';
import fs from 'fs';

afterEach(() => {
  _resetDb();
  if (fs.existsSync('/tmp/threadsponder-test.db')) {
    fs.unlinkSync('/tmp/threadsponder-test.db');
  }
});
```

- [ ] **Step 3: Run all tests**

```bash
pnpm --filter @threadsponder/api test
pnpm --filter @threadsponder/shared test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/vitest.config.ts packages/api/src/__tests__/
git commit -m "test: update e2e tests for SQLite — remove Supabase/Upstash mocks"
```

---

### Task 11: Clean up .env.example + AGENTS.md

**Files:**
- Modify: `.env.example`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update .env.example**

Replace with:

```env
# =============================================================================
# Threadsponder — zero external services required
# =============================================================================

# SQLite database path (default: ./threadsponder.db)
# SQLITE_DB_PATH=./threadsponder.db

# Encryption key for Threads API tokens (generate: openssl rand -base64 32)
CREDENTIAL_ENCRYPTION_KEY=your-32-byte-base64-key

# OpenRouter (AI classification + response generation)
OPENROUTER_API_KEY=sk-or-v1-...

# Threads credentials (auto-seeded into DB on first start)
THREADS_ACCESS_TOKEN=your-threads-access-token
THREADS_USER_ID=your-threads-user-id
# THREADS_USERNAME=your-username

# --- Optional ---
# App ports
PORT=3008          # API
# PORT=8080        # Workers (set per-process)

# Dashboard URL (for CORS)
DASHBOARD_URL=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Z.AI fast classifier (faster than OpenRouter for classification)
# Z_AI_API_KEY=...

# Threads OAuth (if you want browser-based account connection)
# THREADS_APP_ID=your-meta-app-id
# THREADS_APP_SECRET=your-meta-app-secret
# THREADS_REDIRECT_URI=http://localhost:3008/api/auth/threads/callback
```

- [ ] **Step 2: Update AGENTS.md setup steps**

Replace Steps 2 (Supabase) and 3 (Upstash Redis) with:

```markdown
## Step 2: Database

Threadsponder uses SQLite — no setup required. A `threadsponder.db` file is created
automatically on first start in the project root.

To use a custom path:
```env
SQLITE_DB_PATH=/path/to/threadsponder.db
```
```

Remove all references to Supabase, Upstash, BullMQ, migrations, pgvector from AGENTS.md.

- [ ] **Step 3: Commit**

```bash
git add .env.example AGENTS.md
git commit -m "docs: update env + AGENTS.md for zero-dependency SQLite setup"
```

---

### Task 12: Remove dead deps from package.json files + final build

- [ ] **Step 1: Verify all package.json files are clean**

```bash
# Shared — should NOT contain: @upstash/redis, @upstash/ratelimit, @supabase/supabase-js
cat packages/shared/package.json | grep -E "upstash|supabase|bullmq|ioredis"

# API — should NOT contain: @supabase/supabase-js, bullmq, ioredis, svix (Clerk webhook)
cat packages/api/package.json | grep -E "supabase|bullmq|ioredis|svix|@clerk"

# Workers — should NOT contain: bullmq, ioredis, @supabase/supabase-js
cat packages/workers/package.json | grep -E "bullmq|ioredis|supabase"
```

Expected: no matches.

- [ ] **Step 2: Full build**

```bash
pnpm build
```

Expected: exits 0.

- [ ] **Step 3: Full test**

```bash
pnpm --filter @threadsponder/shared test
pnpm --filter @threadsponder/api test
```

Expected: all tests PASS.

- [ ] **Step 4: Smoke test — start the API**

```bash
# In one terminal:
CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32) pnpm --filter @threadsponder/api dev &
curl http://localhost:3008/health
```

Expected: `{"status":"ok","uptime":...}`

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: remove all Supabase/Upstash/BullMQ/IORedis dependencies"
git push origin main
```

---

## Post-migration checklist

- [ ] `threadsponder.db` is added to `.gitignore`
- [ ] `README.md` updated: "Requirements: Node 18+, pnpm — no other services needed"
- [ ] Voice embeddings: cosine similarity helper documented in `shared/src/db/sqlite.ts`
- [ ] Supabase migrations folder (`supabase/`) can be archived or deleted

## Known trade-offs vs previous architecture

| Feature | Before | After | Impact |
|---------|--------|-------|--------|
| Concurrent writes | PostgreSQL MVCC | SQLite WAL mode | Low — single user |
| Vector similarity | pgvector native | JS cosine similarity | Slow for >10k examples |
| Job dedup | Redis NX lock | In-memory Map | Lost on restart (acceptable) |
| Rate limiting | Distributed Upstash | In-memory per-process | Fine for single process |
| Horizontal scaling | Possible | Not supported | Acceptable for OSS single-user |
