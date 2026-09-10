import { getDb } from './sqlite.js';

export type InferenceKind = 'classify' | 'respond';
export const INFERENCE_TIMEOUT_MS = 240_000;

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

export function submitAnswer(id: string, answer: unknown): string {
  expireInference();
  return getDb().transaction(() => {
    const row = getDb().prepare('SELECT kind, status, answer FROM pending_inference WHERE id = ?')
      .get(id) as { kind: InferenceKind; status: string; answer: string | null } | undefined;
    if (!row) throw new Error('Inference not found; run human-queue list');
    validateAnswer(row.kind, answer);
    const json = JSON.stringify(answer);
    if (row.status === 'answered' && row.answer === json) return 'already answered';
    if (row.status !== 'pending') throw new Error(`Inference is ${row.status}; run human-queue list`);
    getDb().prepare("UPDATE pending_inference SET status = 'answered', answer = ? WHERE id = ? AND status = 'pending'")
      .run(json, id);
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
