import { getDb } from './sqlite.js';

export type InferenceKind = 'classify' | 'respond';
export const INFERENCE_TIMEOUT_MS = 240_000;
/** Retention for answered/expired inference rows before deletion (default 30 days). */
export const INFERENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
    `DELETE FROM pending_inference WHERE status IN ('answered', 'expired') AND created_at < ?`).run(cutoff).changes;
  const replies = db.prepare(
    `DELETE FROM pending_replies WHERE status IN ('approved', 'rejected') AND created_at < ?`).run(cutoff).changes;
  const discovery = db.prepare(
    `DELETE FROM discovery_candidates WHERE status IN ('reviewed', 'rejected') AND created_at < ?`).run(cutoff).changes;
  return { inference, replies, discovery };
}
