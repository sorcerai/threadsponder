import { getDb } from './sqlite.js';

export type InferenceKind = 'classify' | 'respond';
export const INFERENCE_TIMEOUT_MS = 240_000;
/** Retention for answered/expired inference rows before deletion (default 30 days). */
export const INFERENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Status values for the human-inference lifecycle. `resumed` is terminal:
 * the resume job has consumed the answer and continued the workflow. */
export type InferenceStatus = 'pending' | 'answered' | 'expired' | 'resumed';

/** Default TTL for processing claims (30 min). A crashed worker's claim is
 * reclaimable after this; normal workflows hold it only until completion. */
export const CLAIM_TTL_MS = 30 * 60 * 1000;
/** TTL for a monitor-tick lease (90s): a tick that overlaps the 1-min cron
 * is skipped rather than run concurrently. */
export const TICK_LEASE_TTL_MS = 90 * 1000;

/** Stable key-sorted JSON so idempotency checks don't depend on key order. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function validateAnswer(kind: InferenceKind, answer: unknown): string {
  if (!answer || typeof answer !== 'object') throw new Error('Answer must be a JSON object');
  const value = answer as Record<string, unknown>;
  if (kind === 'respond') {
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 500) {
      throw new Error('Respond answer requires text (1–500 characters)');
    }
    return value.text;
  }
  if (!['friendly', 'neutral', 'hostile', 'skip'].includes(String(value.classification)) ||
      typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) ||
      value.confidence < 0 || value.confidence > 1 || typeof value.reasoning !== 'string') {
    throw new Error('Classify answer requires classification, confidence (0–1), reasoning');
  }
  return JSON.stringify(value);
}

export function expireInference(): void {
  getDb().prepare(`UPDATE pending_inference SET status = 'expired'
    WHERE status = 'pending' AND created_at <= datetime('now', '-4 minutes')`).run();
}

export function submitAnswer(id: string | number, answer: unknown): string {
  expireInference();
  return getDb().transaction(() => {
    const row = getDb().prepare('SELECT kind, status, answer FROM pending_inference WHERE id = ?')
      .get(id) as { kind: InferenceKind; status: string; answer: string | null } | undefined;
    if (!row) throw new Error('Inference not found; run human-queue list');
    validateAnswer(row.kind, answer);
    const json = canonicalize(answer);
    if (row.status === 'answered' && row.answer !== null && canonicalize(JSON.parse(row.answer)) === json) {
      return 'already answered';
    }
    if (row.status !== 'pending') throw new Error(`Inference is ${row.status}; run human-queue list`);
    const result = getDb().prepare("UPDATE pending_inference SET status = 'answered', answer = ? WHERE id = ? AND status = 'pending'")
      .run(json, id);
    if (result.changes === 0) {
      // Lost the race: another process answered or expired the row between read and update.
      const fresh = getDb().prepare('SELECT status FROM pending_inference WHERE id = ?')
        .get(id) as { status: string } | undefined;
      throw new Error(`Inference is ${fresh?.status ?? 'gone'}; run human-queue list`);
    }
    return 'answered';
  })();
}

export async function waitForHuman(kind: InferenceKind, payload: unknown): Promise<string | null> {
  expireInference();
  const db = getDb();
  const row = db.prepare('INSERT INTO pending_inference (kind, payload) VALUES (?, ?) RETURNING id')
    .get(kind, JSON.stringify(payload)) as { id: string };
  const deadline = Date.now() + INFERENCE_TIMEOUT_MS;
  while (true) {
    expireInference();
    const result = db.prepare('SELECT status, answer FROM pending_inference WHERE id = ?')
      .get(row.id) as { status: string; answer: string | null } | undefined;
    if (result?.status === 'answered') return validateAnswer(kind, JSON.parse(result.answer!));
    if (!result || result.status === 'expired') return null;
    if (Date.now() >= deadline) {
      db.prepare("UPDATE pending_inference SET status = 'expired' WHERE id = ? AND status = 'pending'").run(row.id);
      return null;
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

/**
 * Retention cleanup: delete answered/expired inference rows, pending_replies and
 * discovery_candidates older than their retention windows. Without this the
 * operator queues grow forever (payloads contain raw social text and prompts).
 */
export function pruneOperatorQueues(retentionMs: number = INFERENCE_RETENTION_MS): {
  inference: number; replies: number; discovery: number;
} {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionMs).toISOString().slice(0, 19).replace('T', ' ');
  const inference = db.prepare(
    `DELETE FROM pending_inference WHERE status IN ('answered', 'expired', 'resumed') AND created_at < ?`).run(cutoff).changes;
  const replies = db.prepare(
    `DELETE FROM pending_replies WHERE status IN ('approved', 'rejected') AND created_at < ?`).run(cutoff).changes;
  const discovery = db.prepare(
    `DELETE FROM discovery_candidates WHERE status IN ('reviewed', 'rejected') AND created_at < ?`).run(cutoff).changes;
  return { inference, replies, discovery };
}

/* ------------------------------------------------------------------ *
 * Async HIL (Step 2): the monitor never blocks on a human answer.     *
 * It enqueues inference and exits; the resume job (workers cron)      *
 * picks up answered rows and continues the reply workflow.            *
 * ------------------------------------------------------------------ */

/**
 * Atomically claim a processing scope (DB-backed mutual exclusion).
 * Returns true when this process holds the claim; false when another
 * live worker holds it. A claim older than ttlMs is treated as stale
 * (crashed worker) and reclaimed.
 */
export function claimScope(scope: string, ttlMs: number = CLAIM_TTL_MS): boolean {
  const db = getDb();
  return db.transaction(() => {
    const inserted = db.prepare('INSERT OR IGNORE INTO processing_claims (scope) VALUES (?)')
      .run(scope).changes;
    if (inserted > 0) return true;
    const row = db.prepare('SELECT created_at FROM processing_claims WHERE scope = ?')
      .get(scope) as { created_at: string } | undefined;
    if (!row) return false; // raced a release; caller retries next tick
    const ageMs = Date.now() - new Date(row.created_at.replace(' ', 'T') + 'Z').getTime();
    if (ageMs < ttlMs) return false;
    // Stale: reclaim it.
    db.prepare('DELETE FROM processing_claims WHERE scope = ?').run(scope);
    return db.prepare('INSERT OR IGNORE INTO processing_claims (scope) VALUES (?)')
      .run(scope).changes > 0;
  })();
}

/** Release a processing claim. Idempotent: releasing a scope nobody holds is a no-op. */
export function releaseScope(scope: string): void {
  getDb().prepare('DELETE FROM processing_claims WHERE scope = ?').run(scope);
}

/** Monitor-tick lease scope for an account. */
export const tickScope = (accountId: string): string => `tick:${accountId}`;
/** Per-reply workflow claim scope. */
export const replyScope = (accountId: string, threadsReplyId: string): string =>
  `reply:${accountId}:${threadsReplyId}`;

/**
 * Enqueue a human-inference request and return its id immediately.
 * Unlike waitForHuman this never blocks: the resume job continues the
 * workflow when the operator answers.
 */
export function enqueueHumanInference(kind: InferenceKind, payload: unknown): string {
  expireInference();
  const row = getDb()
    .prepare('INSERT INTO pending_inference (kind, payload) VALUES (?, ?) RETURNING id')
    .get(kind, JSON.stringify(payload)) as { id: string };
  return row.id;
}

export interface ClaimedInference {
  id: string;
  kind: InferenceKind;
  payload: unknown;
  answer: unknown;
}

/**
 * Atomically claim the oldest answered inference row for the resume job.
 * The CAS UPDATE (status='answered' -> 'resumed') guarantees exactly one
 * worker consumes each answer; a second worker gets null.
 */
export function claimAnsweredInference(): ClaimedInference | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare(
      `SELECT id, kind, payload, answer FROM pending_inference
       WHERE status = 'answered' ORDER BY created_at, id LIMIT 1`
    ).get() as { id: string; kind: InferenceKind; payload: string; answer: string } | undefined;
    if (!row) return null;
    const claimed = db.prepare(
      `UPDATE pending_inference SET status = 'resumed' WHERE id = ? AND status = 'answered'`
    ).run(row.id).changes;
    if (claimed === 0) return null; // lost the race
    return { id: row.id, kind: row.kind, payload: JSON.parse(row.payload), answer: JSON.parse(row.answer) };
  })();
}

/**
 * Reap expired-but-unconsumed inference rows: transition them to the
 * terminal `resumed` state and release the workflow claim stored in the
 * payload, so the reply is not retried forever by the monitor.
 * Returns the reaped rows (id + payload) so the caller can record skips.
 */
export function reapExpiredInference(): Array<{ id: string; payload: unknown }> {
  expireInference();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, payload FROM pending_inference WHERE status = 'expired'`
  ).all() as Array<{ id: string; payload: string }>;
  const reaped: Array<{ id: string; payload: unknown }> = [];
  for (const row of rows) {
    const payload = JSON.parse(row.payload) as { claimScope?: string };
    const claimed = db.prepare(
      `UPDATE pending_inference SET status = 'resumed' WHERE id = ? AND status = 'expired'`
    ).run(row.id).changes;
    if (claimed === 0) continue; // another worker reaped it
    if (payload.claimScope) releaseScope(payload.claimScope);
    reaped.push({ id: row.id, payload });
  }
  return reaped;
}
