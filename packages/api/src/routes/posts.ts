/**
 * Posts Routes
 *
 * Focused posts and scheduled posts
 */

import express, { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ThreadsClient } from '@threadsponder/shared/clients/threads.js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';

/**
 * Decrypt access token stored in database
 */
function decryptToken(encrypted: string): string {
  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv
  );
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

const focusedPostSchema = z.object({
  threadsAccountId: z.string().uuid(),
  postId: z.string().min(1),
  postText: z.string().optional(),
  // Dual URL format storage
  permalinkCom: z.string().optional(),  // threads.com/@user/post/shortcode
  permalinkNet: z.string().optional(),  // threads.net/post/numericId
  shortcode: z.string().optional(),      // Just the shortcode part
});

/**
 * Extract post info from Threads URL
 * Supports both formats:
 * - https://www.threads.com/@username/post/SHORTCODE (user-facing)
 * - https://www.threads.net/post/NUMERICID (API/internal)
 */
function extractPostInfo(input: string): {
  identifier: string;
  isNumericId: boolean;
  username?: string;
  permalinkCom?: string;
  permalinkNet?: string;
} | null {
  if (!input) return null;
  const trimmed = input.trim();

  // If it's already just numbers (a numeric post ID)
  if (/^\d+$/.test(trimmed)) {
    return {
      identifier: trimmed,
      isNumericId: true,
      permalinkNet: `https://www.threads.net/post/${trimmed}`
    };
  }

  // threads.com/@username/post/SHORTCODE format
  const comMatch = trimmed.match(/threads\.com\/@([^\/]+)\/post\/([A-Za-z0-9_-]+)/);
  if (comMatch) {
    return {
      identifier: comMatch[2],
      isNumericId: false,
      username: comMatch[1],
      permalinkCom: `https://www.threads.com/@${comMatch[1]}/post/${comMatch[2]}`
    };
  }

  // threads.com/t/SHORTCODE format (short URL - store original, we can't get username from this)
  const shortUrlMatch = trimmed.match(/threads\.com\/t\/([A-Za-z0-9_-]+)/);
  if (shortUrlMatch) {
    return {
      identifier: shortUrlMatch[1],
      isNumericId: false,
      // Store the original /t/ URL as permalinkCom since it works
      permalinkCom: `https://www.threads.com/t/${shortUrlMatch[1]}`
    };
  }

  // threads.net/post/NUMERICID format
  const netMatch = trimmed.match(/threads\.net\/post\/(\d+)/);
  if (netMatch) {
    return {
      identifier: netMatch[1],
      isNumericId: true,
      permalinkNet: `https://www.threads.net/post/${netMatch[1]}`
    };
  }

  // Generic /post/ pattern fallback
  const postMatch = trimmed.match(/\/post\/([A-Za-z0-9_-]+)/);
  if (postMatch) {
    const isNumeric = /^\d+$/.test(postMatch[1]);
    return {
      identifier: postMatch[1],
      isNumericId: isNumeric,
      permalinkNet: isNumeric ? `https://www.threads.net/post/${postMatch[1]}` : undefined
    };
  }

  return null;
}

const scheduledPostSchema = z.object({
  threadsAccountId: z.string().uuid(),
  content: z.string().min(1).max(500),
  mediaUrls: z.array(z.string()).optional(),
  scheduledFor: z.string().datetime(),
});

// =====================
// FOCUSED POSTS
// =====================

/**
 * GET /api/posts/focused
 * List focused posts to monitor
 */
router.get('/focused', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data, error } = await getSupabase()
      .from('focused_posts')
      .select(`
        id, post_id, post_text, is_active, created_at,
        permalink_com, permalink_net, shortcode,
        threads_accounts (id, threads_username)
      `)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ posts: data || [] });
  } catch (error) {
    console.error('[Posts] Failed to list focused posts:', error);
    res.status(500).json({ error: 'Failed to list focused posts' });
  }
});

/**
 * POST /api/posts/focused
 * Add a post to monitor
 */
router.post('/focused', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const parsed = focusedPostSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { threadsAccountId, postId, postText, permalinkCom, permalinkNet, shortcode } = parsed.data;

    // Verify threads account belongs to user and get credentials for API call
    const { data: threadsAccount } = await getSupabase()
      .from('threads_accounts')
      .select('id, threads_user_id, access_token_encrypted')
      .eq('id', threadsAccountId)
      .eq('account_id', accountId)
      .single();

    if (!threadsAccount) {
      return res.status(403).json({ error: 'Threads account not found' });
    }

    // Extract URL info if not provided directly
    const urlInfo = extractPostInfo(postId);
    let finalPermalinkCom = permalinkCom || urlInfo?.permalinkCom || null;
    let finalPermalinkNet = permalinkNet || urlInfo?.permalinkNet || null;
    let finalShortcode = shortcode || (!urlInfo?.isNumericId ? urlInfo?.identifier : null) || null;

    // If we only have a numeric ID (no permalinkCom), fetch the proper permalink from Threads API
    const numericId = urlInfo?.isNumericId ? urlInfo.identifier : null;
    if (!finalPermalinkCom && numericId && threadsAccount.access_token_encrypted) {
      try {
        const accessToken = decryptToken(threadsAccount.access_token_encrypted);
        const client = new ThreadsClient({
          accessToken,
          userId: threadsAccount.threads_user_id,
        });

        const postDetails = await client.getPostDetails(numericId);
        if (postDetails.success && postDetails.post?.permalink) {
          // Threads API returns threads.com/@username/post/shortcode format
          finalPermalinkCom = postDetails.post.permalink;
          // Extract shortcode from permalink
          const shortcodeMatch = postDetails.post.permalink.match(/\/post\/([A-Za-z0-9_-]+)/);
          if (shortcodeMatch) {
            finalShortcode = shortcodeMatch[1];
          }
          console.log(`[Posts] Fetched permalink for post ${numericId}: ${finalPermalinkCom}`);
        }
      } catch (apiError) {
        console.warn(`[Posts] Could not fetch permalink for post ${numericId}:`, apiError);
        // Continue without permalink - we'll still save what we have
      }
    }

    const { data, error } = await getSupabase()
      .from('focused_posts')
      .insert({
        account_id: accountId,
        threads_account_id: threadsAccountId,
        post_id: postId,
        post_text: postText || null,
        permalink_com: finalPermalinkCom,
        permalink_net: finalPermalinkNet,
        shortcode: finalShortcode,
        is_active: true,
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json({ success: true, post: data });
  } catch (error) {
    console.error('[Posts] Failed to add focused post:', error);
    res.status(500).json({ error: 'Failed to add focused post' });
  }
});

/**
 * DELETE /api/posts/focused/:id
 * Remove a focused post
 */
router.delete('/focused/:id', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    const { error } = await getSupabase()
      .from('focused_posts')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('[Posts] Failed to delete focused post:', error);
    res.status(500).json({ error: 'Failed to delete focused post' });
  }
});

/**
 * PATCH /api/posts/focused/:id/toggle
 * Toggle focused post monitoring
 */
router.patch('/focused/:id/toggle', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    const { data: current } = await getSupabase()
      .from('focused_posts')
      .select('is_active')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const { data, error } = await getSupabase()
      .from('focused_posts')
      .update({ is_active: !current.is_active })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, is_active')
      .single();

    if (error) throw error;

    res.json({ success: true, post: data });
  } catch (error) {
    console.error('[Posts] Failed to toggle focused post:', error);
    res.status(500).json({ error: 'Failed to toggle focused post' });
  }
});

// =====================
// SCHEDULED POSTS
// =====================

/**
 * GET /api/posts/scheduled
 * List scheduled posts
 */
router.get('/scheduled', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const status = req.query.status as string | undefined;

    let query = getSupabase()
      .from('scheduled_posts')
      .select(`
        id, content, media_urls, scheduled_for, status, posted_id, error_message, created_at,
        threads_accounts (id, threads_username)
      `)
      .eq('account_id', accountId)
      .order('scheduled_for', { ascending: true });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({ posts: data || [] });
  } catch (error) {
    console.error('[Posts] Failed to list scheduled posts:', error);
    res.status(500).json({ error: 'Failed to list scheduled posts' });
  }
});

/**
 * POST /api/posts/scheduled
 * Schedule a new post
 */
router.post('/scheduled', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const parsed = scheduledPostSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { threadsAccountId, content, mediaUrls, scheduledFor } = parsed.data;

    // Verify threads account belongs to user
    const { data: threadsAccount } = await getSupabase()
      .from('threads_accounts')
      .select('id')
      .eq('id', threadsAccountId)
      .eq('account_id', accountId)
      .single();

    if (!threadsAccount) {
      return res.status(403).json({ error: 'Threads account not found' });
    }

    const { data, error } = await getSupabase()
      .from('scheduled_posts')
      .insert({
        account_id: accountId,
        threads_account_id: threadsAccountId,
        content,
        media_urls: mediaUrls || [],
        scheduled_for: scheduledFor,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw error;

    res.json({ success: true, post: data });
  } catch (error) {
    console.error('[Posts] Failed to schedule post:', error);
    res.status(500).json({ error: 'Failed to schedule post' });
  }
});

/**
 * PUT /api/posts/scheduled/:id
 * Update a scheduled post
 */
router.put('/scheduled/:id', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const { content, scheduledFor, mediaUrls } = req.body;

    // Only allow updating pending posts
    const { data: current } = await getSupabase()
      .from('scheduled_posts')
      .select('status')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (current.status !== 'pending') {
      return res.status(400).json({ error: 'Can only edit pending posts' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (content) updates.content = content;
    if (scheduledFor) updates.scheduled_for = scheduledFor;
    if (mediaUrls) updates.media_urls = mediaUrls;

    const { data, error } = await getSupabase()
      .from('scheduled_posts')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ success: true, post: data });
  } catch (error) {
    console.error('[Posts] Failed to update scheduled post:', error);
    res.status(500).json({ error: 'Failed to update scheduled post' });
  }
});

/**
 * DELETE /api/posts/scheduled/:id
 * Cancel/delete a scheduled post
 */
router.delete('/scheduled/:id', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    // Check if post is pending
    const { data: current } = await getSupabase()
      .from('scheduled_posts')
      .select('status')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (current.status === 'posted') {
      return res.status(400).json({ error: 'Cannot delete posted posts' });
    }

    const { error } = await getSupabase()
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('[Posts] Failed to delete scheduled post:', error);
    res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
});

export default router;
