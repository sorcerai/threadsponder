/**
 * Friends Routes
 *
 * Manage friends list for banter/roast mode (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

/**
 * GET /api/friends
 * List all friends
 */
router.get('/', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const friends = db.prepare(
      'SELECT id, threads_username, mode, created_at FROM friends WHERE account_id = ? ORDER BY threads_username ASC'
    ).all(accountId);

    res.json({ friends });
  } catch (error) {
    console.error('[Friends] Failed to list friends:', error);
    res.status(500).json({ error: 'Failed to list friends' });
  }
});

/**
 * POST /api/friends
 * Add a friend
 */
router.post('/', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { username, mode } = req.body;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username required' });
    }

    const validModes = ['banter', 'roast'];
    const friendMode = mode && validModes.includes(mode) ? mode : 'banter';

    const normalizedUsername = username.replace(/^@/, '').toLowerCase();
    const db = getDb();
    const id = crypto.randomUUID();

    try {
      db.prepare(
        `INSERT INTO friends (id, account_id, threads_username, mode, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`
      ).run(id, accountId, normalizedUsername, friendMode);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err &&
          (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'Friend already exists' });
      }
      throw err;
    }

    const friend = db.prepare(
      'SELECT id, threads_username, mode, created_at FROM friends WHERE id = ?'
    ).get(id);

    res.json({ success: true, friend });
  } catch (error) {
    console.error('[Friends] Failed to add friend:', error);
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

/**
 * PUT /api/friends/:id
 * Update a friend (only mode can be updated)
 */
router.put('/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const { mode } = req.body;

    if (!mode || !['banter', 'roast'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be banter or roast' });
    }

    const db = getDb();

    const current = db.prepare(
      'SELECT id FROM friends WHERE id = ? AND account_id = ?'
    ).get(id, accountId);

    if (!current) {
      return res.status(404).json({ error: 'Friend not found' });
    }

    db.prepare('UPDATE friends SET mode = ? WHERE id = ? AND account_id = ?').run(mode, id, accountId);

    const friend = db.prepare(
      'SELECT id, threads_username, mode, created_at FROM friends WHERE id = ?'
    ).get(id);

    res.json({ success: true, friend });
  } catch (error) {
    console.error('[Friends] Failed to update friend:', error);
    res.status(500).json({ error: 'Failed to update friend' });
  }
});

/**
 * DELETE /api/friends/:id
 * Remove a friend
 */
router.delete('/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    db.prepare('DELETE FROM friends WHERE id = ? AND account_id = ?').run(id, accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('[Friends] Failed to delete friend:', error);
    res.status(500).json({ error: 'Failed to delete friend' });
  }
});

/**
 * PATCH /api/friends/:id/mode
 * Toggle friend mode (banter/roast)
 */
router.patch('/:id/mode', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    const current = db.prepare(
      'SELECT mode FROM friends WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { mode: string } | undefined;

    if (!current) {
      return res.status(404).json({ error: 'Friend not found' });
    }

    const newMode = current.mode === 'banter' ? 'roast' : 'banter';
    db.prepare('UPDATE friends SET mode = ? WHERE id = ? AND account_id = ?').run(newMode, id, accountId);

    const friend = db.prepare(
      'SELECT id, threads_username, mode, created_at FROM friends WHERE id = ?'
    ).get(id);

    res.json({ success: true, friend });
  } catch (error) {
    console.error('[Friends] Failed to toggle friend mode:', error);
    res.status(500).json({ error: 'Failed to toggle friend mode' });
  }
});

export default router;
