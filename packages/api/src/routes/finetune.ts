/**
 * Finetune Routes
 *
 * Banned phrases CRUD + stubbed pattern/feedback routes (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

/**
 * POST /api/finetune/feedback
 * Not supported — reply_history has no rating column in SQLite schema
 */
router.post('/feedback', (_req, res: Response) => {
  res.json({ success: false, error: 'Feedback not supported in this version' });
});

/**
 * GET /api/finetune/stats
 */
router.get('/stats', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const bannedResult = db.prepare(
      'SELECT COUNT(*) as count FROM banned_phrases WHERE account_id = ?'
    ).get(accountId) as { count: number };

    res.json({
      success: true,
      stats: {
        totalFeedback: 0,
        positiveCount: 0,
        negativeCount: 0,
        overallScore: 50,
        bestPattern: null,
        worstPattern: null,
        patternsTracked: 0,
        bannedPhrases: bannedResult.count,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/finetune/patterns
 */
router.get('/patterns', (_req, res: Response) => {
  res.json({ success: true, patterns: [] });
});

/**
 * DELETE /api/finetune/patterns
 */
router.delete('/patterns', (_req, res: Response) => {
  res.json({ success: true, deleted: 0 });
});

/**
 * DELETE /api/finetune/patterns/:pattern
 */
router.delete('/patterns/:pattern', (_req, res: Response) => {
  res.json({ success: true, deleted: 0 });
});

/**
 * GET /api/finetune/replies-for-rating
 */
router.get('/replies-for-rating', (_req, res: Response) => {
  res.json({ success: true, replies: [], count: 0 });
});

/**
 * POST /api/finetune/auto-eval
 */
router.post('/auto-eval', (_req, res: Response) => {
  res.status(501).json({ success: false, error: 'Auto-eval not supported in this version' });
});

/**
 * POST /api/finetune/auto-eval-batch
 */
router.post('/auto-eval-batch', (_req, res: Response) => {
  res.status(501).json({ success: false, error: 'Auto-eval not supported in this version' });
});

/**
 * GET /api/finetune/fresh-hostile
 */
router.get('/fresh-hostile', (_req, res: Response) => {
  res.json({ success: true, comments: [], count: 0, totalRaw: 0, totalResponded: 0 });
});

/**
 * POST /api/finetune/manual-eval
 */
router.post('/manual-eval', (_req, res: Response) => {
  res.status(501).json({ success: false, error: 'Manual eval not supported in this version' });
});

// =====================
// BANNED PHRASES CRUD
// =====================

/**
 * GET /api/finetune/banned
 */
router.get('/banned', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const phrases = db.prepare(
      'SELECT id, phrase, created_at FROM banned_phrases WHERE account_id = ? ORDER BY created_at DESC'
    ).all(accountId);

    res.json({ success: true, phrases, count: (phrases as unknown[]).length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/finetune/banned
 */
router.post('/banned', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { phrase } = req.body;

    if (!phrase) {
      return res.status(400).json({ error: 'Phrase required' });
    }

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO banned_phrases (id, account_id, phrase, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(account_id, phrase) DO NOTHING`
    ).run(id, accountId, phrase);

    const banned = db.prepare(
      'SELECT id, phrase, created_at FROM banned_phrases WHERE account_id = ? AND phrase = ?'
    ).get(accountId, phrase);

    res.json({ success: true, banned });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * DELETE /api/finetune/banned/:phrase
 */
router.delete('/banned/:phrase', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { phrase } = req.params;
    const db = getDb();

    db.prepare(
      'DELETE FROM banned_phrases WHERE account_id = ? AND phrase = ?'
    ).run(accountId, phrase);

    res.json({ success: true, removed: phrase });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
