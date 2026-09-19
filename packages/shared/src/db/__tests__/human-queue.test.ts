import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { getDb, _resetDb } from '../sqlite.js';
import { waitForHuman, submitAnswer, pruneOperatorQueues, canonicalize } from '../human-queue.js';
import { HUMAN_SCHEMA_SQL } from '../human-schema.js';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

beforeEach(() => { process.env.SQLITE_DB_PATH = ':memory:'; vi.useFakeTimers(); });
afterEach(() => { _resetDb(); vi.useRealTimers(); });

interface PendingInferenceRow {
  id: number;
  payload: string;
  status: string;
}

interface SchemaRow {
  type: string;
  name: string;
  sql: string | null;
}

const schemaOf = (sql: string) => {
  const db = new Database(':memory:');
  db.exec(sql);
  db.exec(sql); // idempotent
  const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as SchemaRow[];
  db.close();
  return rows;
};

test('SQL migration produces the same idempotent schema as runtime', () => {
  const migration = readFileSync('src/db/migrations/001_human_in_the_loop.sql', 'utf8');
  expect(schemaOf(migration)).toEqual(schemaOf(HUMAN_SCHEMA_SQL));
});

test('human answer is validated, atomic and idempotent', async () => {
  const pending = waitForHuman('respond', { prompt: 'Full context' });
  const row = getDb().prepare('SELECT * FROM pending_inference').get() as PendingInferenceRow;
  expect(JSON.parse(row.payload)).toEqual({ prompt: 'Full context' });
  expect(() => submitAnswer(row.id, { text: '' })).toThrow();
  expect(submitAnswer(row.id, { text: 'Thanks!' })).toBe('answered');
  expect(submitAnswer(row.id, { text: 'Thanks!' })).toBe('already answered');
  expect(() => submitAnswer(row.id, { text: 'Changed' })).toThrow();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toBe('Thanks!');
});

test('timeout expires requests and rejects late answers', async () => {
  const pending = waitForHuman('classify', {});
  await vi.advanceTimersByTimeAsync(240_000);
  expect(await pending).toBeNull();
  const row = getDb().prepare('SELECT * FROM pending_inference').get() as PendingInferenceRow;
  expect(row.status).toBe('expired');
  expect(() => submitAnswer(row.id, { classification: 'neutral', confidence: 1, reasoning: 'OK' })).toThrow('expired');
});

test('idempotency ignores JSON key order', () => {
  const row = getDb().prepare("INSERT INTO pending_inference (kind, payload) VALUES ('classify', '{}') RETURNING id").get() as { id: number };
  const answer = { classification: 'neutral', confidence: 1, reasoning: 'OK' };
  expect(submitAnswer(row.id, answer)).toBe('answered');
  expect(submitAnswer(row.id, { reasoning: 'OK', confidence: 1, classification: 'neutral' })).toBe('already answered');
});

test('losing the submit race reports the true status', () => {
  const db = getDb();
  const row = db.prepare("INSERT INTO pending_inference (kind, payload) VALUES ('respond', '{}') RETURNING id").get() as { id: number };
  // Flip the row to expired after submitAnswer's read but before its UPDATE,
  // simulating another process winning the race.
  type Prepare = (...args: unknown[]) => { run: (...args: unknown[]) => unknown };
  const origPrepare = (db.prepare as unknown as Prepare).bind(db);
  const dbPatch = db as unknown as { prepare: Prepare };
  dbPatch.prepare = (sql: unknown, ...rest: unknown[]) => {
    const stmt = origPrepare(sql, ...rest);
    if (typeof sql === 'string' && sql.includes("SET status = 'answered'")) {
      origPrepare("UPDATE pending_inference SET status = 'expired' WHERE id = ?").run(row.id);
    }
    return stmt;
  };
  try {
    expect(() => submitAnswer(row.id, { text: 'Hi' })).toThrow('expired');
  } finally {
    dbPatch.prepare = origPrepare;
  }
});

test('canonicalize is key-order stable', () => {
  expect(canonicalize({ b: 1, a: { y: 2, x: 1 } })).toBe(canonicalize({ a: { x: 1, y: 2 }, b: 1 }));
});

test('pruneOperatorQueues removes only terminal, aged rows', () => {
  const db = getDb();
  db.prepare("INSERT INTO pending_inference (kind, payload, status, created_at) VALUES ('classify', '{}', 'expired', '2020-01-01 00:00:00')").run();
  db.prepare("INSERT INTO pending_inference (kind, payload, status, created_at) VALUES ('classify', '{}', 'pending', '2020-01-01 00:00:00')").run();
  const pruned = pruneOperatorQueues(24 * 60 * 60 * 1000);
  expect(pruned.inference).toBe(1);
  const remaining = db.prepare('SELECT status FROM pending_inference').all() as { status: string }[];
  expect(remaining.map(r => r.status)).toEqual(['pending']);
});
