/**
 * Threads Routes
 *
 * Connect/manage Threads accounts (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb, encryptCredential } from '@threadsponder/shared';

const router: Router = express.Router();

/**
 * GET /api/threads/accounts
 * List connected Threads accounts
 */
router.get('/accounts', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const accounts = db.prepare(
      'SELECT id, threads_user_id, threads_username, is_active, created_at FROM threads_accounts WHERE account_id = ? ORDER BY created_at DESC'
    ).all(accountId);

    res.json({ accounts });
  } catch (error) {
    console.error('[Threads] Failed to list accounts:', error);
    res.status(500).json({ error: 'Failed to list accounts' });
  }
});

/**
 * POST /api/threads/connect
 * Connect a Threads account (manual token paste)
 */
router.post('/connect', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { accessToken, userId, username } = req.body;

    if (!accessToken || !userId) {
      return res.status(400).json({ error: 'accessToken and userId required' });
    }

    const encryptedToken = encryptCredential(accessToken);
    if (!encryptedToken) {
      console.error('[Threads] Failed to encrypt token - check CREDENTIAL_ENCRYPTION_KEY');
      return res.status(500).json({ error: 'Encryption configuration error' });
    }

    const db = getDb();

    db.prepare(`
      INSERT INTO threads_accounts (id, account_id, threads_user_id, threads_username, access_token_encrypted, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
      ON CONFLICT(account_id, threads_user_id) DO UPDATE SET
        access_token_encrypted = excluded.access_token_encrypted,
        threads_username = excluded.threads_username,
        is_active = 1,
        updated_at = datetime('now')
    `).run(crypto.randomUUID(), accountId, userId, username || null, encryptedToken);

    const account = db.prepare(
      'SELECT id, threads_user_id, threads_username, is_active FROM threads_accounts WHERE account_id = ? AND threads_user_id = ?'
    ).get(accountId, userId) as { id: string; threads_user_id: string; threads_username: string | null; is_active: number } | undefined;

    res.json({ success: true, account });
  } catch (error) {
    console.error('[Threads] Failed to connect account:', error);
    res.status(500).json({ error: 'Failed to connect account' });
  }
});

/**
 * DELETE /api/threads/accounts/:id
 * Disconnect a Threads account
 */
router.delete('/accounts/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    db.prepare('DELETE FROM threads_accounts WHERE id = ? AND account_id = ?').run(id, accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('[Threads] Failed to disconnect account:', error);
    res.status(500).json({ error: 'Failed to disconnect account' });
  }
});

/**
 * PATCH /api/threads/accounts/:id/toggle
 * Toggle account active status
 */
router.patch('/accounts/:id/toggle', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    const current = db.prepare(
      'SELECT is_active FROM threads_accounts WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { is_active: number } | undefined;

    if (!current) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const newActive = current.is_active ? 0 : 1;
    db.prepare(
      'UPDATE threads_accounts SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ? AND account_id = ?'
    ).run(newActive, id, accountId);

    const account = db.prepare(
      'SELECT id, is_active FROM threads_accounts WHERE id = ?'
    ).get(id) as { id: string; is_active: number } | undefined;

    res.json({ success: true, account });
  } catch (error) {
    console.error('[Threads] Failed to toggle account:', error);
    res.status(500).json({ error: 'Failed to toggle account' });
  }
});

export default router;
