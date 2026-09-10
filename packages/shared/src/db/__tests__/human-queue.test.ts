import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { getDb, _resetDb } from '../sqlite.js';
import { waitForHuman, submitAnswer } from '../human-queue.js';
import { HUMAN_SCHEMA_SQL } from '../human-schema.js';
import { readFileSync } from 'node:fs';

beforeEach(() => { process.env.SQLITE_DB_PATH = ':memory:'; vi.useFakeTimers(); });
afterEach(() => { _resetDb(); vi.useRealTimers(); });

test('SQL migration matches runtime and can run repeatedly', () => {
  expect(readFileSync('src/db/migrations/001_human_in_the_loop.sql', 'utf8')).toContain(HUMAN_SCHEMA_SQL);
  getDb().exec(HUMAN_SCHEMA_SQL);
  getDb().exec(HUMAN_SCHEMA_SQL);
});

test('human answer is validated, atomic and idempotent', async () => {
  const pending = waitForHuman('respond', { prompt: 'Full context' });
  const row = getDb().prepare('SELECT * FROM pending_inference').get() as any;
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
  const row = getDb().prepare('SELECT * FROM pending_inference').get() as any;
  expect(row.status).toBe('expired');
  expect(() => submitAnswer(row.id, { classification: 'neutral', confidence: 1, reasoning: 'OK' })).toThrow('expired');
});
