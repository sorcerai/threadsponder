/**
 * Post Scheduler Job
 *
 * Publishes scheduled posts at their scheduled time:
 * 1. Load scheduled post from SQLite
 * 2. Get Threads credentials
 * 3. Publish to Threads API
 * 4. Update status in SQLite
 */

import { getDb, ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';

function updatePostStatus(
  postId: string,
  status: 'pending' | 'posted' | 'failed' | 'cancelled',
  updates: { posted_id?: string; error_message?: string } = {}
): void {
  const db = getDb();
  db.prepare(`
    UPDATE scheduled_posts
    SET status = ?, posted_id = ?, error_message = ?, posted_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    updates.posted_id ?? null,
    updates.error_message ?? null,
    status === 'posted' ? new Date().toISOString() : null,
    new Date().toISOString(),
    postId
  );
}

async function publishScheduledPost(
  scheduledPostId: string
): Promise<{ posted: boolean; postId?: string }> {
  console.log(`[PostScheduler] Publishing post ${scheduledPostId}`);

  const db = getDb();
  const scheduledPost = db
    .prepare('SELECT * FROM scheduled_posts WHERE id = ? AND status = ?')
    .get(scheduledPostId, 'pending') as {
      id: string;
      account_id: string;
      threads_account_id: string;
      content: string;
      media_urls: string;
    } | undefined;

  if (!scheduledPost) {
    console.error(`[PostScheduler] Post not found or not pending: ${scheduledPostId}`);
    return { posted: false };
  }

  const tenantService = getTenantService();
  const isActive = tenantService.isSubscriptionActive(scheduledPost.account_id);

  if (!isActive) {
    console.log(`[PostScheduler] Subscription not active, skipping`);
    updatePostStatus(scheduledPostId, 'failed', {
      error_message: 'Subscription not active',
    });
    return { posted: false };
  }

  const credentials = tenantService.getThreadsCredentials(scheduledPost.threads_account_id);

  if (!credentials) {
    console.error(`[PostScheduler] Failed to get credentials`);
    updatePostStatus(scheduledPostId, 'failed', {
      error_message: 'Failed to load Threads credentials',
    });
    return { posted: false };
  }

  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  try {
    const mediaUrls: string[] = JSON.parse(scheduledPost.media_urls || '[]');
    let mediaType: 'TEXT' | 'IMAGE' | 'VIDEO' = 'TEXT';
    let imageUrl: string | undefined;
    let videoUrl: string | undefined;

    if (mediaUrls.length > 0) {
      const firstUrl = mediaUrls[0];
      if (/\.(mp4|mov|avi|webm)(\?|$)/i.test(firstUrl)) {
        mediaType = 'VIDEO';
        videoUrl = firstUrl;
      } else if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(firstUrl)) {
        mediaType = 'IMAGE';
        imageUrl = firstUrl;
      }
    }

    const result = await client.createPost({
      text: scheduledPost.content,
      mediaType,
      imageUrl,
      videoUrl,
    });

    if (result.success && result.postId) {
      console.log(`[PostScheduler] Posted successfully: ${result.postId}`);
      updatePostStatus(scheduledPostId, 'posted', { posted_id: result.postId });
      return { posted: true, postId: result.postId };
    } else {
      throw new Error('Post creation returned null');
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[PostScheduler] Failed to post:`, err);
    updatePostStatus(scheduledPostId, 'failed', { error_message: errorMessage });
    return { posted: false };
  }
}

/**
 * Publish all due scheduled posts.
 * Called by cron every minute.
 */
export async function scheduleDuePosts(): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  const duePosts = db
    .prepare('SELECT id FROM scheduled_posts WHERE status = ? AND scheduled_for <= ? LIMIT 50')
    .all('pending', now) as Array<{ id: string }>;

  let published = 0;
  for (const post of duePosts) {
    try {
      const result = await publishScheduledPost(post.id);
      if (result.posted) published++;
    } catch (error) {
      console.error(`[PostScheduler] Error publishing ${post.id}:`, error);
    }
  }

  if (published > 0) {
    console.log(`[PostScheduler] Published ${published} posts`);
  }

  return published;
}
