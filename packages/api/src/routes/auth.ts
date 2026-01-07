import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { z } from 'zod';
import { oauthState } from '@threadsponder/shared';

const router: Router = Router();

// Ensure process.env is treated as string
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const THREADS_APP_ID = process.env.THREADS_APP_ID || '';
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET || '';
const THREADS_REDIRECT_URI = process.env.THREADS_REDIRECT_URI || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

function getSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * Encrypt OAuth token with AES-256-CBC
 * FAIL-CLOSED: Throws error if ENCRYPTION_KEY not set in production
 */
function encryptToken(token: string): string {
    if (!ENCRYPTION_KEY) {
        if (NODE_ENV === 'production') {
            throw new Error('ENCRYPTION_KEY is required in production - refusing to store unencrypted tokens');
        }
        console.warn('[AUTH] WARNING: ENCRYPTION_KEY not set - tokens stored unencrypted (dev only)');
        return `UNENCRYPTED:${token}`;
    }
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        Buffer.from(ENCRYPTION_KEY, 'hex'),
        iv
    );
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Generate cryptographically secure CSRF state token
 */
function generateStateToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

// Start OAuth flow
router.get('/threads', async (req: Request, res: Response) => {
    try {
        if (!THREADS_APP_ID || !THREADS_REDIRECT_URI) {
            return res.status(500).json({ error: 'OAuth not configured' });
        }

        // Get orgId from authenticated request (Clerk middleware should provide this)
        // For now, we require it as a query parameter until Clerk integration is complete
        const orgId = req.query.org_id as string;
        if (!orgId) {
            return res.status(400).json({
                error: 'org_id is required',
                message: 'Organization ID must be provided to connect Threads account'
            });
        }

        // Generate CSRF state token and store with orgId in Redis (5min TTL)
        const stateToken = generateStateToken();
        await oauthState.set(stateToken, orgId);

        const scopes = [
            'threads_basic',
            'threads_content_publish'
        ].join(',');

        const url = `https://threads.net/oauth/authorize?client_id=${THREADS_APP_ID}&redirect_uri=${encodeURIComponent(THREADS_REDIRECT_URI)}&scope=${scopes}&response_type=code&state=${stateToken}`;

        res.redirect(url);
    } catch (error) {
        console.error('[OAuth] Start flow error:', error);
        res.status(500).json({ error: 'Failed to start OAuth flow' });
    }
});

// OAuth Callback
router.get('/threads/callback', async (req: Request, res: Response) => {
    try {
        const { code, state, error, error_description } = req.query;

        if (error) {
            console.error('[OAuth] Threads error:', error, error_description);
            return res.redirect(`/?error=${encodeURIComponent(String(error_description))}`);
        }

        if (!code) {
            return res.redirect('/?error=no_code');
        }

        // CSRF Protection: Validate state token and get orgId
        if (!state || typeof state !== 'string') {
            console.error('[OAuth] Missing state parameter - possible CSRF attack');
            return res.redirect('/?error=invalid_state');
        }

        const orgId = await oauthState.validate(state);
        if (!orgId) {
            console.error('[OAuth] Invalid or expired state token - possible CSRF attack');
            return res.redirect('/?error=state_expired');
        }

        // Exchange code for token
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', THREADS_APP_ID);
        tokenParams.append('client_secret', THREADS_APP_SECRET);
        tokenParams.append('grant_type', 'authorization_code');
        tokenParams.append('redirect_uri', THREADS_REDIRECT_URI);
        tokenParams.append('code', String(code));

        const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
            method: 'POST',
            body: tokenParams,
        });

        // Explicitly type the response to avoid unknown/any errors
        const tokenData = await tokenRes.json() as { access_token?: string; user_id?: number | string; error?: any };

        if (!tokenData.access_token) {
            console.error('[OAuth] Failed to get token:', tokenData);
            return res.redirect('/?error=token_exchange_failed');
        }

        const { access_token, user_id } = tokenData;

        // Encrypt token (fail-closed in production if no ENCRYPTION_KEY)
        let encryptedToken: string;
        try {
            encryptedToken = encryptToken(access_token!);
        } catch (encryptError) {
            console.error('[OAuth] Encryption failed:', encryptError);
            return res.redirect('/?error=encryption_failed');
        }

        // Save to Supabase with proper tenant isolation
        const { error: dbError } = await getSupabase()
            .from('threads_accounts')
            .upsert(
                {
                    organization_id: orgId,  // Tenant isolation via orgId from validated state
                    threads_user_id: String(user_id),
                    threads_username: null, // Fetched separately via profile API
                    encrypted_access_token: encryptedToken,
                    is_active: true,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: 'organization_id,threads_user_id',
                }
            );

        if (dbError) {
            console.error('[OAuth] DB Error:', dbError);
            return res.redirect('/?error=db_save_failed');
        }

        console.log(`[OAuth] Successfully connected Threads account for org ${orgId}`);
        res.redirect('/?success=connected');

    } catch (error) {
        console.error('[OAuth] Callback error:', error);
        res.redirect('/?error=internal_error');
    }
});

export default router;
