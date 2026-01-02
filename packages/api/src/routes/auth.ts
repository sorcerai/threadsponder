import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { z } from 'zod';

const router: Router = Router();

// Ensure process.env is treated as string
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const THREADS_APP_ID = process.env.THREADS_APP_ID || '';
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET || '';
const THREADS_REDIRECT_URI = process.env.THREADS_REDIRECT_URI || '';

function getSupabase() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function encryptToken(token: string): string {
    if (!ENCRYPTION_KEY) return token; // Fallback if no key (dev)
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

// Start OAuth flow
router.get('/threads', (req: Request, res: Response) => {
    if (!THREADS_APP_ID || !THREADS_REDIRECT_URI) {
        return res.status(500).json({ error: 'OAuth not configured' });
    }

    const scopes = [
        'threads_basic',
        'threads_content_publish'
    ].join(',');

    const url = `https://threads.net/oauth/authorize?client_id=${THREADS_APP_ID}&redirect_uri=${encodeURIComponent(THREADS_REDIRECT_URI)}&scope=${scopes}&response_type=code`;

    res.redirect(url);
});

// OAuth Callback
router.get('/threads/callback', async (req: Request, res: Response) => {
    try {
        const { code, error, error_description } = req.query;

        if (error) {
            console.error('[OAuth] Threads error:', error, error_description);
            return res.redirect(`/?error=${encodeURIComponent(String(error_description))}`);
        }

        if (!code) {
            return res.redirect('/?error=no_code');
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

        // Encrypt token
        const encryptedToken = encryptToken(access_token!);

        // Save to Supabase
        // Note: In a real app, we need to know WHICH account this belongs to.
        // For this MVP, we assume a single account or 'default' until we have proper state passing.
        // We can try to get accountId from req.query.state if we passed it earlier.
        const accountId = (req.query.state as string) || 'default_account';

        const { error: dbError } = await getSupabase()
            .from('threads_accounts')
            .upsert(
                {
                    account_id: accountId,
                    threads_user_id: String(user_id),
                    threads_username: null, // We'd need another call to get username
                    access_token_encrypted: encryptedToken,
                    is_active: true,
                },
                {
                    onConflict: 'account_id,threads_user_id',
                }
            );

        if (dbError) {
            console.error('DB Error:', dbError);
            return res.redirect('/?error=db_save_failed');
        }

        res.redirect('/?success=connected');

    } catch (error) {
        console.error('[OAuth] Callback error:', error);
        res.redirect('/?error=internal_error');
    }
});

export default router;
