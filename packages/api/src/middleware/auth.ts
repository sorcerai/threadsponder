/**
 * Auth Middleware — Standalone Mode
 *
 * No external auth provider. Auto-seeds a default account
 * and injects it into every request.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { encryptCredential } from '@threadsponder/shared';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

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
async function getOrCreateAccount(): Promise<string | null> {
  if (_cachedAccountId) return _cachedAccountId;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const userId = process.env.DEFAULT_ORG_ID || 'standalone';

  // Check if account exists
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('clerk_user_id', userId)
    .single();

  if (existing) {
    _cachedAccountId = existing.id;
    return existing.id;
  }

  // Create account
  const { data: newAccount, error } = await supabase
    .from('accounts')
    .insert({
      clerk_user_id: userId,
      name: 'Standalone User',
      email: `${userId}@localhost`,
      subscription_status: 'active',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Auth] Failed to create standalone account:', error);
    return null;
  }

  console.log(`[Auth] Created standalone account: ${newAccount.id}`);
  _cachedAccountId = newAccount.id;

  // Auto-seed Threads credentials from env if available
  await seedThreadsCredentials(supabase, newAccount.id);

  return newAccount.id;
}

/**
 * If THREADS_ACCESS_TOKEN and THREADS_USER_ID are set in env,
 * auto-create a threads_accounts row so workers can start immediately.
 */
async function seedThreadsCredentials(supabase: any, accountId: string): Promise<void> {
  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const threadsUserId = process.env.THREADS_USER_ID;

  if (!accessToken || !threadsUserId) return;

  // Check if already exists
  const { data: existing } = await supabase
    .from('threads_accounts')
    .select('id')
    .eq('account_id', accountId)
    .eq('threads_user_id', threadsUserId)
    .single();

  if (existing) return;

  try {
    const encrypted = encryptCredential(accessToken);
    const tokenValue = encrypted || accessToken; // fallback to plaintext if no encryption key

    await supabase.from('threads_accounts').insert({
      account_id: accountId,
      threads_user_id: threadsUserId,
      threads_username: process.env.THREADS_USERNAME || null,
      access_token_encrypted: tokenValue,
      is_active: true,
    });
    console.log(`[Auth] Seeded Threads credentials for user ${threadsUserId}`);
  } catch (err) {
    console.error('[Auth] Failed to seed Threads credentials:', err);
  }
}

/**
 * Standalone auth middleware — no JWT, just injects account context
 */
export const authMiddleware: RequestHandler[] = [
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const accountId = await getOrCreateAccount();

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
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const accountId = await getOrCreateAccount();
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
