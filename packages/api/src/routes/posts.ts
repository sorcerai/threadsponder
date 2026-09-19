/**
 * Posts Routes
 *
 * Focused posts and scheduled posts (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { ThreadsClient, getDb, decryptCredential } from '@threadsponder/shared';

const router: Router = express.Router();

const focusedPostSchema = z.object({
  threadsAccountId: z.string().uuid(),
  postId: z.string().min(1),
  postText: z.string().optional(),
  // These fields are accepted but NOT stored (schema doesn't have them)
  permalinkCom: z.string().optional(),
  permalinkNet: z.string().optional(),
  shortcode: z.string().optional(),
  targetClassifications: z.array(z.enum(['hostile', 'friendly', 'neutral'])).optional(),
});

/**
 * Extract post info from Threads URL
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

  if (/^\d+$/.test(trimmed)) {
    return {
      identifier: trimmed,
      isNumericId: true,
      permalinkNet: `https://www.threads.net/post/${trimmed}`,
    };
  }

  const comMatch = trimmed.match(/threads\.com\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/);
  if (comMatch) {
    return {
      identifier: comMatch[2],
      isNumericId: false,
      username: comMatch[1],
      permalinkCom: `https://www.threads.com/@${comMatch[1]}/post/${comMatch[2]}`,
    };
  }

  const shortUrlMatch = trimmed.match(/threads\.com\/t\/([A-Za-z0-9_-]+)/);
  if (shortUrlMatch) {
    return {
      identifier: shortUrlMatch[1],
      isNumericId: false,
      permalinkCom: `https://www.threads.com/t/${shortUrlMatch[1]}`,
    };
  }

  const netMatch = trimmed.match(/threads\.net\/post\/(\d+)/);
  if (netMatch) {
    return {
      identifier: netMatch[1],
      isNumericId: true,
      permalinkNet: `https://www.threads.net/post/${netMatch[1]}`,
    };
  }

  const postMatch = trimmed.match(/\/post\/([A-Za-z0-9_-]+)/);
  if (postMatch) {
    const isNumeric = /^\d+$/.test(postMatch[1]);
    return {
      identifier: postMatch[1],
      isNumericId: isNumeric,
      permalinkNet: isNumeric ? `https://www.threads.net/post/${postMatch[1]}` : undefined,
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
router.get('/focused', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const posts = db.prepare(
      'SELECT id, threads_post_id, post_text, is_active, created_at, threads_account_id FROM focused_posts WHERE account_id = ? ORDER BY created_at DESC'
    ).all(accountId);

    res.json({ posts });
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

    const { threadsAccountId, postId, postText } = parsed.data;
    const db = getDb();

    // Verify threads account belongs to user
    const threadsAccount = db.prepare(
      'SELECT id, threads_user_id, access_token_encrypted FROM threads_accounts WHERE id = ? AND account_id = ?'
    ).get(threadsAccountId, accountId) as {
      id: string;
      threads_user_id: string;
      access_token_encrypted: string;
    } | undefined;

    if (!threadsAccount) {
      return res.status(403).json({ error: 'Threads account not found' });
    }

    // Determine the numeric/identifier post ID to store
    const urlInfo = extractPostInfo(postId);
    const threadsPostId = urlInfo?.identifier || postId;

    // Optionally fetch post details from Threads API for postText if not provided
    let finalPostText = postText || null;
    const numericId = urlInfo?.isNumericId ? urlInfo.identifier : null;
    if (!finalPostText && numericId && threadsAccount.access_token_encrypted) {
      try {
        const accessToken = decryptCredential(threadsAccount.access_token_encrypted);
        if (accessToken) {
          const client = new ThreadsClient({
            accessToken,
            userId: threadsAccount.threads_user_id,
          });
          const postDetails = await client.getPostDetails(numericId);
          if (postDetails.success && postDetails.post?.text) {
            finalPostText = postDetails.post.text;
          }
        }
      } catch (apiError) {
        console.warn(`[Posts] Could not fetch post details for ${numericId}:`, apiError);
      }
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO focused_posts (id, account_id, threads_account_id, threads_post_id, post_text, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`
    ).run(id, accountId, threadsAccountId, threadsPostId, finalPostText);

    const post = db.prepare(
      'SELECT id, threads_post_id, post_text, is_active, created_at, threads_account_id FROM focused_posts WHERE id = ?'
    ).get(id);

    res.json({ success: true, post });
  } catch (error) {
    console.error('[Posts] Failed to add focused post:', error);
    res.status(500).json({ error: 'Failed to add focused post' });
  }
});

/**
 * DELETE /api/posts/focused/:id
 * Remove a focused post
 */
router.delete('/focused/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    db.prepare('DELETE FROM focused_posts WHERE id = ? AND account_id = ?').run(id, accountId);

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
router.patch('/focused/:id/toggle', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    const current = db.prepare(
      'SELECT is_active FROM focused_posts WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { is_active: number } | undefined;

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const newActive = current.is_active ? 0 : 1;
    db.prepare(
      'UPDATE focused_posts SET is_active = ? WHERE id = ? AND account_id = ?'
    ).run(newActive, id, accountId);

    const post = db.prepare(
      'SELECT id, is_active FROM focused_posts WHERE id = ?'
    ).get(id);

    res.json({ success: true, post });
  } catch (error) {
    console.error('[Posts] Failed to toggle focused post:', error);
    res.status(500).json({ error: 'Failed to toggle focused post' });
  }
});

/**
 * PATCH /api/posts/focused/:id/classifications
 * Not supported in SQLite schema
 */
router.patch('/focused/:id/classifications', (_req, res: Response) => {
  res.status(501).json({ error: 'Target classifications not supported in SQLite schema' });
});

// =====================
// SCHEDULED POSTS
// =====================

/**
 * GET /api/posts/scheduled
 * List scheduled posts
 */
router.get('/scheduled', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const status = req.query.status as string | undefined;
    const db = getDb();

    let sql = 'SELECT id, content, media_urls, scheduled_for, status, posted_id, error_message, created_at, threads_account_id FROM scheduled_posts WHERE account_id = ?';
    const params: unknown[] = [accountId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY scheduled_for ASC';

    const posts = db.prepare(sql).all(...params);

    res.json({ posts });
  } catch (error) {
    console.error('[Posts] Failed to list scheduled posts:', error);
    res.status(500).json({ error: 'Failed to list scheduled posts' });
  }
});

/**
 * POST /api/posts/scheduled
 * Schedule a new post
 */
router.post('/scheduled', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const parsed = scheduledPostSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { threadsAccountId, content, mediaUrls, scheduledFor } = parsed.data;
    const db = getDb();

    // Verify threads account belongs to user
    const threadsAccount = db.prepare(
      'SELECT id FROM threads_accounts WHERE id = ? AND account_id = ?'
    ).get(threadsAccountId, accountId);

    if (!threadsAccount) {
      return res.status(403).json({ error: 'Threads account not found' });
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO scheduled_posts (id, account_id, threads_account_id, content, media_urls, scheduled_for, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
    ).run(id, accountId, threadsAccountId, content, JSON.stringify(mediaUrls || []), scheduledFor);

    const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id);

    res.json({ success: true, post });
  } catch (error) {
    console.error('[Posts] Failed to schedule post:', error);
    res.status(500).json({ error: 'Failed to schedule post' });
  }
});

/**
 * PUT /api/posts/scheduled/:id
 * Update a scheduled post
 */
router.put('/scheduled/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const { content, scheduledFor, mediaUrls } = req.body;
    const db = getDb();

    const current = db.prepare(
      'SELECT status FROM scheduled_posts WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { status: string } | undefined;

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (current.status !== 'pending') {
      return res.status(400).json({ error: 'Can only edit pending posts' });
    }

    const setParts: string[] = ["updated_at = datetime('now')"];
    const params: unknown[] = [];

    if (content) { setParts.push('content = ?'); params.push(content); }
    if (scheduledFor) { setParts.push('scheduled_for = ?'); params.push(scheduledFor); }
    if (mediaUrls) { setParts.push('media_urls = ?'); params.push(JSON.stringify(mediaUrls)); }

    params.push(id, accountId);
    db.prepare(`UPDATE scheduled_posts SET ${setParts.join(', ')} WHERE id = ? AND account_id = ?`).run(...params);

    const post = db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id);

    res.json({ success: true, post });
  } catch (error) {
    console.error('[Posts] Failed to update scheduled post:', error);
    res.status(500).json({ error: 'Failed to update scheduled post' });
  }
});

/**
 * DELETE /api/posts/scheduled/:id
 * Cancel/delete a scheduled post
 */
router.delete('/scheduled/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    const current = db.prepare(
      'SELECT status FROM scheduled_posts WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { status: string } | undefined;

    if (!current) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (current.status === 'posted') {
      return res.status(400).json({ error: 'Cannot delete posted posts' });
    }

    db.prepare('DELETE FROM scheduled_posts WHERE id = ? AND account_id = ?').run(id, accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('[Posts] Failed to delete scheduled post:', error);
    res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
});

export default router;
