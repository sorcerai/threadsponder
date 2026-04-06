/**
 * Auth Middleware — Standalone Mode
 *
 * No external auth provider. Auto-seeds a default account
 * and injects it into every request.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getDb, encryptCredential } from '@threadsponder/shared';

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    accountId: string;
  };
}

let _cachedAccountId: string | null = null;

/**
 * Get or create the standalone account.
 */
function getOrCreateAccount(): string | null {
  if (_cachedAccountId) return _cachedAccountId;

  const db = getDb();
  const userId = process.env.DEFAULT_ORG_ID || 'standalone';

  const existing = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: string } | undefined;
  if (existing) {
    _cachedAccountId = existing.id;
    return existing.id;
  }

  try {
    db.prepare(
      'INSERT INTO accounts (user_id, name, email, subscription_status) VALUES (?, ?, ?, ?)'
    ).run(userId, 'Standalone User', `${userId}@localhost`, 'active');

    const newAccount = db.prepare('SELECT id FROM accounts WHERE user_id = ?').get(userId) as { id: string };
    console.log(`[Auth] Created standalone account: ${newAccount.id}`);
    _cachedAccountId = newAccount.id;

    // Auto-seed Threads credentials from env if available
    seedThreadsCredentials(newAccount.id);

    return newAccount.id;
  } catch (err) {
    console.error('[Auth] Failed to create standalone account:', err);
    return null;
  }
}

/**
 * If THREADS_ACCESS_TOKEN and THREADS_USER_ID are set in env,
 * auto-create a threads_accounts row so workers can start immediately.
 */
function seedThreadsCredentials(accountId: string): void {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;

  if (!accessToken || !threadsUserId) return;

  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM threads_accounts WHERE account_id = ? AND threads_user_id = ?'
  ).get(accountId, threadsUserId);

  if (existing) return;

  try {
    const encrypted = encryptCredential(accessToken);
    const tokenValue = encrypted || accessToken; // fallback to plaintext if no encryption key

    db.prepare(
      'INSERT INTO threads_accounts (account_id, threads_user_id, threads_username, access_token_encrypted, is_active) VALUES (?, ?, ?, ?, 1)'
    ).run(accountId, threadsUserId, process.env.THREADS_USERNAME || null, tokenValue);

    console.log(`[Auth] Seeded Threads credentials for user ${threadsUserId}`);
  } catch (err) {
    console.error('[Auth] Failed to seed Threads credentials:', err);
  }
}

/**
 * Standalone auth middleware — no JWT, just injects account context
 */
export const authMiddleware: RequestHandler[] = [
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      const accountId = getOrCreateAccount();

      if (!accountId) {
        console.error('[Auth] No account available');
        return next();
      }

      (req as unknown as AuthenticatedRequest).auth = {
        userId: process.env.DEFAULT_ORG_ID || 'standalone',
        accountId,
      };

      next();
    } catch (error) {
      console.error('[Auth] Middleware error:', error);
      next();
    }
  },
];

/**
 * Optional auth — same behavior in standalone mode
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const accountId = getOrCreateAccount();
    if (accountId) {
      (req as unknown as AuthenticatedRequest).auth = {
        userId: process.env.DEFAULT_ORG_ID || 'standalone',
        accountId,
      };
    }
    next();
  } catch {
    next();
  }
};
