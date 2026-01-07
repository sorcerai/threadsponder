/**
 * Post Scheduler Job
 *
 * Publishes scheduled posts at their scheduled time:
 * 1. Load scheduled post from Supabase
 * 2. Get Threads credentials
 * 3. Publish to Threads API
 * 4. Update status in Supabase
 */

import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';

export interface SchedulerJobData {
  scheduledPostId: string;
}

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const postSchedulerQueue = new Queue<SchedulerJobData>('post-scheduler', {
  connection,
});

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

/**
 * Update scheduled post status
 */
async function updatePostStatus(
  postId: string,
  status: 'pending' | 'posted' | 'failed' | 'cancelled',
  updates: { posted_id?: string; error_message?: string } = {}
): Promise<void> {
  await getSupabase()
    .from('scheduled_posts')
    .update({
      status,
      posted_at: status === 'posted' ? new Date().toISOString() : null,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId);
}

/**
 * Publish a scheduled post
 */
async function publishScheduledPost(
  job: Job<SchedulerJobData>
): Promise<{ posted: boolean; postId?: string }> {
  const { scheduledPostId } = job.data;

  console.log(`[PostScheduler] Publishing post ${scheduledPostId}`);

  // Load scheduled post
  const { data: scheduledPost, error } = await getSupabase()
    .from('scheduled_posts')
    .select('*')
    .eq('id', scheduledPostId)
    .eq('status', 'pending')
    .single();

  if (error || !scheduledPost) {
    console.error(`[PostScheduler] Post not found or not pending:`, error);
    return { posted: false };
  }

  // Check subscription is active
  const tenantService = getTenantService();
  const isActive = await tenantService.isSubscriptionActive(scheduledPost.account_id);

  if (!isActive) {
    console.log(`[PostScheduler] Subscription not active, skipping`);
    await updatePostStatus(scheduledPostId, 'failed', {
      error_message: 'Subscription not active',
    });
    return { posted: false };
  }

  // Get Threads credentials
  const credentials = await tenantService.getThreadsCredentials(
    scheduledPost.threads_account_id
  );

  if (!credentials) {
    console.error(`[PostScheduler] Failed to get credentials`);
    await updatePostStatus(scheduledPostId, 'failed', {
      error_message: 'Failed to load Threads credentials',
    });
    return { posted: false };
  }

  // Create Threads client
  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  try {
    // Publish the post
    // TODO: Handle media_urls for image/video posts
    const result = await client.createPost(scheduledPost.content);

    if (result.success && result.postId) {
      console.log(`[PostScheduler] Posted successfully: ${result.postId}`);
      await updatePostStatus(scheduledPostId, 'posted', {
        posted_id: result.postId,
      });
      return { posted: true, postId: result.postId };
    } else {
      throw new Error('Post creation returned null');
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[PostScheduler] Failed to post:`, err);
    await updatePostStatus(scheduledPostId, 'failed', {
      error_message: errorMessage,
    });
    return { posted: false };
  }
}

// Create worker
export const postSchedulerWorker = new Worker<SchedulerJobData>(
  'post-scheduler',
  publishScheduledPost,
  {
    connection,
    concurrency: 3,
  }
);

postSchedulerWorker.on('failed', (job, err) => {
  console.error(`[PostScheduler] Job ${job?.id} failed:`, err);
});

postSchedulerWorker.on('completed', (job, result) => {
  console.log(
    `[PostScheduler] Job ${job.id} completed: posted=${result.posted}`
  );
});

/**
 * Schedule jobs for all due posts
 * Called by cron every minute
 */
export async function scheduleDuePosts(): Promise<number> {
  const now = new Date().toISOString();

  // Find all pending posts that are due
  const { data: duePosts, error } = await getSupabase()
    .from('scheduled_posts')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .limit(50);

  if (error || !duePosts) {
    console.error('[PostScheduler] Failed to find due posts:', error);
    return 0;
  }

  let scheduled = 0;

  for (const post of duePosts) {
    // Check if job already exists
    const existingJobs = await postSchedulerQueue.getJobs(['active', 'waiting']);
    const hasExisting = existingJobs.some(
      (j) => j.data.scheduledPostId === post.id
    );

    if (!hasExisting) {
      await postSchedulerQueue.add(
        'publish',
        { scheduledPostId: post.id },
        {
          jobId: `publish:${post.id}`,
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );
      scheduled++;
    }
  }

  if (scheduled > 0) {
    console.log(`[PostScheduler] Scheduled ${scheduled} posts for publishing`);
  }

  return scheduled;
}
