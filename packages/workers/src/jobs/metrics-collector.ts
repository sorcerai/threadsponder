/**
 * Metrics Collector Job
 *
 * Per-tenant job that:
 * 1. Fetches metrics for recent posts
 * 2. Stores snapshots in post_metrics table
 * 3. Calculates velocity and engagement rate
 * 4. Updates post_performance summary
 * 5. Periodically updates account velocity baseline
 */

import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface MetricsJobData {
  accountId: string;
  threadsAccountId: string;
}

interface PostMetricsSnapshot {
  postId: string;
  views: number;
  likes: number;
  replies: number;
  quotes: number;
  reposts: number;
  shares: number;
  timestamp: Date;
}

interface PostPerformanceUpdate {
  postId: string;
  currentViews: number;
  currentLikes: number;
  currentReplies: number;
  currentQuotes: number;
  currentReposts: number;
  currentShares: number;
  engagementRate: number;
  velocityAt1h?: number;
  velocityAt6h?: number;
  velocityAt24h?: number;
  velocityVsAvg?: number;
  engagementVsAvg?: number;
  peakVelocity?: number;
}

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Maximum age for posts to collect metrics (7 days)
const MAX_POST_AGE_DAYS = 7;

// Interval between snapshots (5 minutes minimum to avoid hitting rate limits)
const MIN_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

// Create Redis connection
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create queue
export const metricsCollectorQueue = new Queue<MetricsJobData>('metrics-collector', {
  connection,
});

// Supabase client
let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

/**
 * Calculate engagement rate: (likes + replies + quotes) / views
 */
function calculateEngagementRate(
  views: number,
  likes: number,
  replies: number,
  quotes: number
): number {
  if (views === 0) return 0;
  return (likes + replies + quotes) / views;
}

/**
 * Calculate velocity: views gained per hour
 */
function calculateVelocity(viewsDelta: number, hoursDelta: number): number {
  if (hoursDelta <= 0) return 0;
  return viewsDelta / hoursDelta;
}

/**
 * Get the last snapshot for a post
 */
async function getLastSnapshot(
  accountId: string,
  postId: string
): Promise<{
  views: number;
  likes: number;
  replies: number;
  snapshotAt: Date;
} | null> {
  const { data } = await getSupabase()
    .from('post_metrics')
    .select('views, likes, replies, snapshot_at')
    .eq('account_id', accountId)
    .eq('post_id', postId)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return null;

  return {
    views: data.views,
    likes: data.likes,
    replies: data.replies,
    snapshotAt: new Date(data.snapshot_at),
  };
}

/**
 * Get account velocity baseline
 */
async function getAccountBaseline(accountId: string): Promise<{
  avgVelocity1h: number;
  avgVelocity6h: number;
  avgVelocity24h: number;
  avgEngagementRate: number;
} | null> {
  const { data } = await getSupabase()
    .from('account_velocity_baseline')
    .select('avg_velocity_1h, avg_velocity_6h, avg_velocity_24h, avg_engagement_rate')
    .eq('account_id', accountId)
    .single();

  if (!data) return null;

  return {
    avgVelocity1h: data.avg_velocity_1h || 0,
    avgVelocity6h: data.avg_velocity_6h || 0,
    avgVelocity24h: data.avg_velocity_24h || 0,
    avgEngagementRate: data.avg_engagement_rate || 0,
  };
}

/**
 * Store a metrics snapshot
 */
async function storeSnapshot(
  accountId: string,
  postId: string,
  metrics: PostMetricsSnapshot,
  lastSnapshot: { views: number; likes: number; replies: number; snapshotAt: Date } | null,
  postCreatedAt: Date | null,
  baseline: { avgVelocity1h: number } | null
): Promise<void> {
  const now = new Date();

  // Calculate deltas from last snapshot
  const viewsDelta = lastSnapshot ? metrics.views - lastSnapshot.views : null;
  const likesDelta = lastSnapshot ? metrics.likes - lastSnapshot.likes : null;
  const repliesDelta = lastSnapshot ? metrics.replies - lastSnapshot.replies : null;

  // Calculate hours since post creation
  const hoursSincePost = postCreatedAt
    ? (now.getTime() - postCreatedAt.getTime()) / (1000 * 60 * 60)
    : null;

  // Calculate engagement rate
  const engagementRate = calculateEngagementRate(
    metrics.views,
    metrics.likes,
    metrics.replies,
    metrics.quotes
  );

  // Calculate velocity score (compared to baseline)
  let velocityScore: number | null = null;
  if (lastSnapshot && baseline && baseline.avgVelocity1h > 0) {
    const hoursSinceLastSnapshot =
      (now.getTime() - lastSnapshot.snapshotAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastSnapshot > 0 && viewsDelta !== null && viewsDelta > 0) {
      const currentVelocity = viewsDelta / hoursSinceLastSnapshot;
      velocityScore = currentVelocity / baseline.avgVelocity1h;
    }
  }

  await getSupabase().from('post_metrics').insert({
    account_id: accountId,
    post_id: postId,
    views: metrics.views,
    likes: metrics.likes,
    replies: metrics.replies,
    quotes: metrics.quotes,
    reposts: metrics.reposts,
    shares: metrics.shares,
    engagement_rate: engagementRate,
    velocity_score: velocityScore,
    views_delta: viewsDelta,
    likes_delta: likesDelta,
    replies_delta: repliesDelta,
    snapshot_at: now.toISOString(),
    hours_since_post: hoursSincePost,
  });
}

/**
 * Update post performance summary
 */
async function updatePostPerformance(
  accountId: string,
  postId: string,
  postText: string | null,
  postedAt: Date | null,
  metrics: PostMetricsSnapshot,
  baseline: { avgVelocity1h: number; avgVelocity24h: number; avgEngagementRate: number } | null
): Promise<void> {
  const now = new Date();
  const engagementRate = calculateEngagementRate(
    metrics.views,
    metrics.likes,
    metrics.replies,
    metrics.quotes
  );

  // Calculate hours since post
  const hoursSincePost = postedAt
    ? (now.getTime() - postedAt.getTime()) / (1000 * 60 * 60)
    : null;

  // Get velocity at specific time points from snapshots
  const velocityData = await calculateVelocityAtTimePoints(accountId, postId, postedAt);

  // Calculate velocity vs average
  let velocityVsAvg: number | null = null;
  let engagementVsAvg: number | null = null;

  if (baseline) {
    if (velocityData.velocityAt1h !== null && baseline.avgVelocity1h > 0) {
      velocityVsAvg = velocityData.velocityAt1h / baseline.avgVelocity1h;
    }
    if (baseline.avgEngagementRate > 0) {
      engagementVsAvg = engagementRate / baseline.avgEngagementRate;
    }
  }

  // Determine evergreen candidacy
  // Posts older than 90 days with 2x average engagement
  const isEvergreenCandidate =
    postedAt &&
    hoursSincePost &&
    hoursSincePost > 90 * 24 &&
    engagementVsAvg !== null &&
    engagementVsAvg >= 2.0;

  await getSupabase()
    .from('post_performance')
    .upsert(
      {
        account_id: accountId,
        post_id: postId,
        post_text: postText,
        posted_at: postedAt?.toISOString() || null,
        current_views: metrics.views,
        current_likes: metrics.likes,
        current_replies: metrics.replies,
        current_quotes: metrics.quotes,
        current_reposts: metrics.reposts,
        current_shares: metrics.shares,
        engagement_rate: engagementRate,
        peak_velocity: velocityData.peakVelocity,
        velocity_at_1h: velocityData.velocityAt1h,
        velocity_at_6h: velocityData.velocityAt6h,
        velocity_at_24h: velocityData.velocityAt24h,
        velocity_vs_avg: velocityVsAvg,
        engagement_vs_avg: engagementVsAvg,
        is_evergreen_candidate: isEvergreenCandidate,
        last_snapshot_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'account_id,post_id' }
    );
}

/**
 * Calculate velocity at specific time points (1h, 6h, 24h)
 */
async function calculateVelocityAtTimePoints(
  accountId: string,
  postId: string,
  postedAt: Date | null
): Promise<{
  velocityAt1h: number | null;
  velocityAt6h: number | null;
  velocityAt24h: number | null;
  peakVelocity: number | null;
}> {
  if (!postedAt) {
    return { velocityAt1h: null, velocityAt6h: null, velocityAt24h: null, peakVelocity: null };
  }

  // Get all snapshots for this post
  const { data: snapshots } = await getSupabase()
    .from('post_metrics')
    .select('views, views_delta, hours_since_post, snapshot_at')
    .eq('account_id', accountId)
    .eq('post_id', postId)
    .order('snapshot_at', { ascending: true });

  if (!snapshots || snapshots.length < 2) {
    return { velocityAt1h: null, velocityAt6h: null, velocityAt24h: null, peakVelocity: null };
  }

  let velocityAt1h: number | null = null;
  let velocityAt6h: number | null = null;
  let velocityAt24h: number | null = null;
  let peakVelocity: number | null = null;

  // Calculate velocities between consecutive snapshots and find values at time points
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];

    const hoursDelta =
      (new Date(curr.snapshot_at).getTime() - new Date(prev.snapshot_at).getTime()) /
      (1000 * 60 * 60);

    if (hoursDelta > 0 && curr.views_delta !== null && curr.views_delta > 0) {
      const velocity = curr.views_delta / hoursDelta;

      // Track peak velocity
      if (peakVelocity === null || velocity > peakVelocity) {
        peakVelocity = velocity;
      }

      // Record velocity at time points
      if (curr.hours_since_post !== null) {
        if (curr.hours_since_post <= 1 && velocityAt1h === null) {
          velocityAt1h = velocity;
        }
        if (curr.hours_since_post <= 6 && velocityAt6h === null) {
          velocityAt6h = velocity;
        }
        if (curr.hours_since_post <= 24 && velocityAt24h === null) {
          velocityAt24h = velocity;
        }
      }
    }
  }

  return { velocityAt1h, velocityAt6h, velocityAt24h, peakVelocity };
}

/**
 * Update account velocity baseline (called periodically)
 */
async function updateAccountBaseline(accountId: string): Promise<void> {
  // Use the database function we created in the migration
  await getSupabase().rpc('update_account_baseline', {
    p_account_id: accountId,
  });
}

/**
 * Collect metrics for a single post
 */
async function collectPostMetrics(
  client: ThreadsClient,
  accountId: string,
  postId: string,
  postText: string | null,
  postedAt: Date | null
): Promise<boolean> {
  try {
    // Fetch metrics from Threads API
    const result = await client.getPostMetrics(postId);

    if (!result.success || !result.metrics) {
      console.log(`[MetricsCollector] Failed to get metrics for post ${postId}`);
      return false;
    }

    const metrics: PostMetricsSnapshot = {
      postId,
      views: result.metrics.views,
      likes: result.metrics.likes,
      replies: result.metrics.replies,
      quotes: result.metrics.quotes,
      reposts: result.metrics.reposts,
      shares: result.metrics.shares,
      timestamp: new Date(),
    };

    // Get last snapshot to check interval and calculate deltas
    const lastSnapshot = await getLastSnapshot(accountId, postId);

    // Skip if we took a snapshot too recently
    if (lastSnapshot) {
      const msSinceLastSnapshot = Date.now() - lastSnapshot.snapshotAt.getTime();
      if (msSinceLastSnapshot < MIN_SNAPSHOT_INTERVAL_MS) {
        console.log(
          `[MetricsCollector] Skipping ${postId} - snapshot too recent (${Math.floor(
            msSinceLastSnapshot / 1000
          )}s ago)`
        );
        return false;
      }
    }

    // Get baseline for velocity calculations
    const baseline = await getAccountBaseline(accountId);

    // Store snapshot
    await storeSnapshot(accountId, postId, metrics, lastSnapshot, postedAt, baseline);

    // Update post performance summary
    await updatePostPerformance(accountId, postId, postText, postedAt, metrics, baseline);

    console.log(
      `[MetricsCollector] Collected metrics for ${postId}: ${metrics.views} views, ${metrics.likes} likes`
    );

    return true;
  } catch (error) {
    console.error(`[MetricsCollector] Error collecting metrics for ${postId}:`, error);
    return false;
  }
}

/**
 * Main job processor
 */
async function processMetricsJob(
  job: Job<MetricsJobData>
): Promise<{ collected: number; updated: number }> {
  const { accountId, threadsAccountId } = job.data;

  console.log(`[MetricsCollector] Processing tenant ${accountId}`);

  const tenantService = getTenantService();

  // Check subscription is active
  const subscriptionActive = await tenantService.isSubscriptionActive(accountId);
  if (!subscriptionActive) {
    console.log(`[MetricsCollector] Tenant ${accountId} subscription not active, skipping`);
    return { collected: 0, updated: 0 };
  }

  // Get Threads credentials
  const credentials = await tenantService.getThreadsCredentials(threadsAccountId);
  if (!credentials) {
    console.error(`[MetricsCollector] Failed to load credentials for ${threadsAccountId}`);
    return { collected: 0, updated: 0 };
  }

  // Create Threads client
  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  // Get focused posts (we track metrics for focused posts)
  const focusedPosts = await tenantService.getFocusedPosts(threadsAccountId);

  // Also get recent posts from the user's profile
  const recentPostsResult = await client.getUserPosts(20);
  const recentPosts =
    recentPostsResult.success && recentPostsResult.posts
      ? recentPostsResult.posts
      : [];

  // Combine and deduplicate posts to track
  const postsToTrack = new Map<
    string,
    { postId: string; postText: string | null; postedAt: Date | null }
  >();

  // Add focused posts
  for (const fp of focusedPosts) {
    postsToTrack.set(fp.post_id, {
      postId: fp.post_id,
      postText: fp.post_text || null,
      postedAt: fp.created_at ? new Date(fp.created_at) : null,
    });
  }

  // Add recent posts (within MAX_POST_AGE_DAYS)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MAX_POST_AGE_DAYS);

  for (const post of recentPosts) {
    const postedAt = post.timestamp ? new Date(post.timestamp) : null;
    if (postedAt && postedAt < cutoffDate) continue; // Skip old posts

    if (!postsToTrack.has(post.id)) {
      postsToTrack.set(post.id, {
        postId: post.id,
        postText: post.text || null,
        postedAt,
      });
    }
  }

  let collected = 0;
  let updated = 0;

  // Collect metrics for each post
  for (const [postId, postInfo] of postsToTrack) {
    const success = await collectPostMetrics(
      client,
      accountId,
      postId,
      postInfo.postText,
      postInfo.postedAt
    );

    if (success) {
      collected++;
      updated++;
    }

    // Small delay between API calls to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  // Update account baseline periodically (every 10th job or if we collected data)
  const shouldUpdateBaseline = collected > 0 || Math.random() < 0.1;
  if (shouldUpdateBaseline) {
    try {
      await updateAccountBaseline(accountId);
      console.log(`[MetricsCollector] Updated baseline for account ${accountId}`);
    } catch (error) {
      console.error(`[MetricsCollector] Failed to update baseline:`, error);
    }
  }

  console.log(
    `[MetricsCollector] Tenant ${accountId}: collected ${collected}, updated ${updated}`
  );

  return { collected, updated };
}

// Create worker
export const metricsCollectorWorker = new Worker<MetricsJobData>(
  'metrics-collector',
  processMetricsJob,
  {
    connection,
    concurrency: 3, // Process up to 3 tenants in parallel
  }
);

// Error handling
metricsCollectorWorker.on('failed', (job, err) => {
  console.error(`[MetricsCollector] Job ${job?.id} failed:`, err);
});

metricsCollectorWorker.on('completed', (job, result) => {
  console.log(
    `[MetricsCollector] Job ${job.id} completed: ${result.collected} collected, ${result.updated} updated`
  );
});

/**
 * Schedule metrics collection jobs for all active tenants
 * Should be called periodically (e.g., every 5 minutes via cron)
 */
export async function scheduleMetricsJobs(): Promise<number> {
  const tenantService = getTenantService();
  const activeTenants = await tenantService.getActiveTenants();

  let scheduled = 0;

  for (const tenant of activeTenants) {
    // Check if a job for this tenant is already in progress
    const existingJobs = await metricsCollectorQueue.getJobs(['active', 'waiting']);
    const hasExisting = existingJobs.some(
      (j) =>
        j.data.accountId === tenant.accountId &&
        j.data.threadsAccountId === tenant.threadsAccountId
    );

    if (!hasExisting) {
      await metricsCollectorQueue.add(
        'collect',
        {
          accountId: tenant.accountId,
          threadsAccountId: tenant.threadsAccountId,
        },
        {
          jobId: `metrics:${tenant.threadsAccountId}:${Date.now()}`,
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );
      scheduled++;
    }
  }

  console.log(
    `[MetricsCollector] Scheduled ${scheduled} jobs for ${activeTenants.length} tenants`
  );
  return scheduled;
}
