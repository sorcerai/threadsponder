import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { getDb, _resetDb } from '../sqlite.js';
import {
  claimScope,
  releaseScope,
  tickScope,
  replyScope,
  enqueueHumanInference,
  claimAnsweredInference,
  submitAnswer,
  reapExpiredInference,
  CLAIM_TTL_MS,
} from '../human-queue.js';

beforeEach(() => { process.env.SQLITE_DB_PATH = ':memory:'; vi.useFakeTimers(); });
afterEach(() => { _resetDb(); vi.useRealTimers(); });

test('claimScope: first claimant wins, second is denied while live', () => {
  expect(claimScope(tickScope('acc1'))).toBe(true);
  expect(claimScope(tickScope('acc1'))).toBe(false);
  // Different scope is independent
  expect(claimScope(tickScope('acc2'))).toBe(true);
  // Per-reply scopes are independent of tick scopes
  expect(claimScope(replyScope('acc1', 'reply-1'))).toBe(true);
});

test('claimScope: release lets the next claimant in, release is idempotent', () => {
  const scope = tickScope('acc1');
  expect(claimScope(scope)).toBe(true);
  releaseScope(scope);
  expect(claimScope(scope)).toBe(true);
  releaseScope(scope);
  releaseScope(scope); // no-op, must not throw
  expect(claimScope(scope)).toBe(true);
});

test('claimScope: stale claims (crashed worker) are reclaimed after TTL', () => {
  const scope = tickScope('acc1');
  expect(claimScope(scope)).toBe(true);
  expect(claimScope(scope)).toBe(false);
  // Backdate the claim past the TTL
  const stale = new Date(Date.now() - CLAIM_TTL_MS - 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  getDb().prepare('UPDATE processing_claims SET created_at = ? WHERE scope = ?').run(stale, scope);
  expect(claimScope(scope)).toBe(true);
  // Fresh claim is still live, not reclaimable
  expect(claimScope(scope)).toBe(false);
});

test('enqueueHumanInference returns immediately; claimAnsweredInference is exactly-once', () => {
  const id = enqueueHumanInference('classify', { prompt: 'Full context' });
  expect(typeof id).toBe('string');
  // Not answered yet: nothing to claim
  expect(claimAnsweredInference()).toBeNull();

  submitAnswer(id, { classification: 'neutral', confidence: 0.9, reasoning: 'looks good' });
  const claimed = claimAnsweredInference();
  expect(claimed).not.toBeNull();
  expect(claimed!.id).toBe(id);
  expect(claimed!.kind).toBe('classify');
  expect(claimed!.payload).toEqual({ prompt: 'Full context' });
  expect(claimed!.answer).toBeTruthy();

  // Second claim returns nothing: exactly-once consumption
  expect(claimAnsweredInference()).toBeNull();
});

test('claimAnsweredInference leaves other answered rows available in FIFO order', () => {
  const id1 = enqueueHumanInference('classify', { n: 1 });
  const id2 = enqueueHumanInference('respond', { n: 2 });
  // Force a deterministic created_at order (both rows would otherwise share a timestamp)
  const earlier = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  getDb().prepare('UPDATE pending_inference SET created_at = ? WHERE id = ?').run(earlier, id1);
  submitAnswer(id1, { classification: 'neutral', confidence: 1, reasoning: 'ok' });
  submitAnswer(id2, { text: 'Hello there' });
  const first = claimAnsweredInference();
  const second = claimAnsweredInference();
  expect(first!.id).toBe(id1);
  expect(second!.id).toBe(id2);
  expect(claimAnsweredInference()).toBeNull();
});

test('reapExpiredInference returns expired rows with parsed payload', () => {
  const id = enqueueHumanInference('respond', { stage: 'respond', replyId: 'r1' });
  // Force-expire the row by backdating created_at past the 4-minute window
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  getDb().prepare('UPDATE pending_inference SET created_at = ? WHERE id = ?').run(past, id);
  const reaped = reapExpiredInference();
  expect(reaped).toHaveLength(1);
  expect(reaped[0].id).toBe(id);
  expect(reaped[0].payload).toEqual({ stage: 'respond', replyId: 'r1' });
  // Second reap is empty: already released
  expect(reapExpiredInference()).toHaveLength(0);
});

test('late answers to expired rows are rejected', () => {
  const id = enqueueHumanInference('classify', {});
  const past = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  getDb().prepare('UPDATE pending_inference SET created_at = ? WHERE id = ?').run(past, id);
  expect(() =>
    submitAnswer(id, { classification: 'neutral', confidence: 1, reasoning: 'late' })
  ).toThrow('expired');
});
