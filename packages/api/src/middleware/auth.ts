/**
 * Auth Middleware
 *
 * Validates Clerk JWT and extracts user context
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { clerkClient, requireAuth } from '@clerk/express';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export interface AuthenticatedRequest extends Request {
  auth: {
    userId: string;
    accountId: string;
  };
}

/**
 * Get or create account for Clerk user
 */
async function getOrCreateAccount(clerkUserId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Check if account exists
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .single();

  if (existing) {
    return existing.id;
  }

  // Get user info from Clerk
  try {
    const user = await clerkClient.users.getUser(clerkUserId);

    // Create new account
    const { data: newAccount, error } = await supabase
      .from('accounts')
      .insert({
        clerk_user_id: clerkUserId,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
        email: user.emailAddresses[0]?.emailAddress || '',
        subscription_status: 'trial',
        subscription_ends_at: new Date(
          Date.now() + 3 * 24 * 60 * 60 * 1000
        ).toISOString(), // 3 days trial
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Auth] Failed to create account:', error);
      return null;
    }

    return newAccount.id;
  } catch (error) {
    console.error('[Auth] Failed to get Clerk user:', error);
    return null;
  }
}

/**
 * Middleware to require authentication and inject account context
 */
export const authMiddleware: RequestHandler[] = [
  requireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clerkUserId = (req as any).auth?.userId;

      if (!clerkUserId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const accountId = await getOrCreateAccount(clerkUserId);

      if (!accountId) {
        return res.status(500).json({ error: 'Failed to get account' });
      }

      (req as unknown as AuthenticatedRequest).auth = {
        userId: clerkUserId,
        accountId,
      };

      next();
    } catch (error) {
      console.error('[Auth] Middleware error:', error);
      return res.status(500).json({ error: 'Authentication failed' });
    }
  },
];

/**
 * Optional auth - doesn't require auth but extracts context if present
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const clerkUserId = (req as any).auth?.userId;

    if (clerkUserId) {
      const accountId = await getOrCreateAccount(clerkUserId);
      if (accountId) {
        (req as unknown as AuthenticatedRequest).auth = {
          userId: clerkUserId,
          accountId,
        };
      }
    }

    next();
  } catch {
    next();
  }
};
