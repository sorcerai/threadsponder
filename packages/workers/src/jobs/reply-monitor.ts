/**
 * Reply Monitor Job
 *
 * Per-tenant job that:
 * 1. Fetches replies on focused posts
 * 2. Classifies each reply
 * 3. Generates and posts responses
 * 4. Records history for analytics
 */

import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';
import { classifyReply, Classification } from '../utils/classifier.js';
import { generateResponse, ResponseContext } from '../utils/responder.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface MonitorJobData {
  accountId: string;
  threadsAccountId: string;
}

interface ProcessedReply {
  replyId: string;
  username: string;
  text: string;
  classification: Classification;
  confidence: number;
  response: string | null;
  posted: boolean;
  postId: string | null;
  error?: string;
}

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Create Redis connection
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create queue
export const replyMonitorQueue = new Queue<MonitorJobData>('reply-monitor', {
  connection,
});

// Supabase client for recording history
let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

/**
 * Check if we've already processed this reply
 */
async function hasProcessedReply(
  accountId: string,
  replyId: string
): Promise<boolean> {
  const { data } = await getSupabase()
    .from('reply_history')
    .select('id')
    .eq('account_id', accountId)
    .eq('original_reply_id', replyId)
    .single();

  return !!data;
}

/**
 * Record reply in history
 */
async function recordReplyHistory(
  accountId: string,
  threadsAccountId: string,
  parentPostId: string,
  processed: ProcessedReply,
  processingTimeMs: number,
  model: string
): Promise<void> {
  await getSupabase().from('reply_history').insert({
    account_id: accountId,
    threads_account_id: threadsAccountId,
    original_reply_id: processed.replyId,
    original_username: processed.username,
    original_text: processed.text,
    parent_post_id: parentPostId,
    classification: processed.classification,
    classification_confidence: processed.confidence,
    our_response: processed.response,
    our_response_id: processed.postId,
    was_posted: processed.posted,
    posted_at: processed.posted ? new Date().toISOString() : null,
    skip_reason: processed.error || null,
    processing_time_ms: processingTimeMs,
    model_used: model,
  });
}

/**
 * Process a single reply
 */
async function processReply(
  ctx: {
    accountId: string;
    threadsAccountId: string;
    client: ThreadsClient;
    parentPost: { id: string; text: string };
    voiceSettings: any;
    voiceExamples: any[];
    friends: any[];
  },
  reply: { id: string; text: string; username: string }
): Promise<ProcessedReply> {
  const startTime = Date.now();

  // Check if already processed
  const alreadyProcessed = await hasProcessedReply(ctx.accountId, reply.id);
  if (alreadyProcessed) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: 'skip',
      confidence: 1,
      response: null,
      posted: false,
      postId: null,
      error: 'Already processed',
    };
  }

  // Skip our own replies
  // (The client handles this, but double-check)
  const credentials = await getTenantService().getThreadsCredentials(
    ctx.threadsAccountId
  );
  if (credentials?.username?.toLowerCase() === reply.username.toLowerCase()) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: 'skip',
      confidence: 1,
      response: null,
      posted: false,
      postId: null,
      error: 'Own reply',
    };
  }

  // Classify the reply
  const classificationResult = await classifyReply(
    ctx.parentPost.text,
    reply.text,
    reply.username,
    OPENROUTER_API_KEY
  );

  // Skip if injection detected
  if (classificationResult.injectionDetected) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: 'skip',
      confidence: 1,
      response: null,
      posted: false,
      postId: null,
      error: 'Injection detected',
    };
  }

  // Skip neutral with low confidence
  if (
    classificationResult.classification === 'neutral' &&
    classificationResult.confidence < 0.7
  ) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      response: null,
      posted: false,
      postId: null,
      error: 'Low confidence neutral',
    };
  }

  // Generate response
  const responseCtx: ResponseContext = {
    originalPost: ctx.parentPost.text,
    replyText: reply.text,
    username: reply.username,
    classification: classificationResult.classification,
    voiceSettings: ctx.voiceSettings,
    voiceExamples: ctx.voiceExamples,
    friends: ctx.friends,
  };

  const generatedResponse = await generateResponse(
    responseCtx,
    OPENROUTER_API_KEY
  );

  if (!generatedResponse.reply) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      response: null,
      posted: false,
      postId: null,
      error: 'Generation failed',
    };
  }

  // Post the response
  try {
    const posted = await ctx.client.replyToPost(reply.id, generatedResponse.reply);

    if (posted) {
      console.log(
        `Posted reply to @${reply.username}: "${generatedResponse.reply.substring(0, 50)}..."`
      );

      // Record in history
      await recordReplyHistory(
        ctx.accountId,
        ctx.threadsAccountId,
        ctx.parentPost.id,
        {
          replyId: reply.id,
          username: reply.username,
          text: reply.text,
          classification: classificationResult.classification,
          confidence: classificationResult.confidence,
          response: generatedResponse.reply,
          posted: true,
          postId: posted.id,
        },
        Date.now() - startTime,
        generatedResponse.source
      );

      return {
        replyId: reply.id,
        username: reply.username,
        text: reply.text,
        classification: classificationResult.classification,
        confidence: classificationResult.confidence,
        response: generatedResponse.reply,
        posted: true,
        postId: posted.id,
      };
    }
  } catch (error) {
    console.error(`Failed to post reply to @${reply.username}:`, error);
  }

  // Record failed post attempt
  await recordReplyHistory(
    ctx.accountId,
    ctx.threadsAccountId,
    ctx.parentPost.id,
    {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      response: generatedResponse.reply,
      posted: false,
      postId: null,
      error: 'Post failed',
    },
    Date.now() - startTime,
    generatedResponse.source
  );

  return {
    replyId: reply.id,
    username: reply.username,
    text: reply.text,
    classification: classificationResult.classification,
    confidence: classificationResult.confidence,
    response: generatedResponse.reply,
    posted: false,
    postId: null,
    error: 'Post failed',
  };
}

/**
 * Main job processor
 */
async function processMonitorJob(
  job: Job<MonitorJobData>
): Promise<{ processed: number; posted: number }> {
  const { accountId, threadsAccountId } = job.data;

  console.log(`[Monitor] Processing tenant ${accountId}`);

  const tenantService = getTenantService();

  // Check subscription is active
  const subscriptionActive = await tenantService.isSubscriptionActive(accountId);
  if (!subscriptionActive) {
    console.log(`[Monitor] Tenant ${accountId} subscription not active, skipping`);
    return { processed: 0, posted: 0 };
  }

  // Get tenant config
  const config = await tenantService.getTenantConfig(accountId);
  if (!config) {
    console.error(`[Monitor] Failed to load config for tenant ${accountId}`);
    return { processed: 0, posted: 0 };
  }

  // Get Threads credentials
  const credentials = await tenantService.getThreadsCredentials(threadsAccountId);
  if (!credentials) {
    console.error(`[Monitor] Failed to load credentials for ${threadsAccountId}`);
    return { processed: 0, posted: 0 };
  }

  // Create Threads client
  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  // Get focused posts
  const focusedPosts = await tenantService.getFocusedPosts(threadsAccountId);
  if (focusedPosts.length === 0) {
    console.log(`[Monitor] No focused posts for ${threadsAccountId}`);
    return { processed: 0, posted: 0 };
  }

  // Get voice examples for all tones
  const voiceExamples = await tenantService.getVoiceExamples(accountId);

  let totalProcessed = 0;
  let totalPosted = 0;

  // Process each focused post
  for (const focusedPost of focusedPosts) {
    try {
      // Fetch replies on this post
      const replies = await client.getPostReplies(focusedPost.post_id, 50);

      if (!replies || replies.length === 0) {
        continue;
      }

      console.log(
        `[Monitor] Found ${replies.length} replies on post ${focusedPost.post_id}`
      );

      // Process each reply
      for (const reply of replies) {
        // Skip if it's the post owner's reply (our own)
        if (reply.isReplyOwnedByMe) {
          continue;
        }

        const result = await processReply(
          {
            accountId,
            threadsAccountId,
            client,
            parentPost: {
              id: focusedPost.post_id,
              text: focusedPost.post_text || '',
            },
            voiceSettings: config.voiceSettings,
            voiceExamples,
            friends: config.friends,
          },
          {
            id: reply.id,
            text: reply.text,
            username: reply.username,
          }
        );

        totalProcessed++;
        if (result.posted) {
          totalPosted++;
        }

        // Small delay between replies to avoid rate limiting
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      console.error(
        `[Monitor] Error processing post ${focusedPost.post_id}:`,
        error
      );
    }
  }

  console.log(
    `[Monitor] Tenant ${accountId}: processed ${totalProcessed}, posted ${totalPosted}`
  );

  return { processed: totalProcessed, posted: totalPosted };
}

// Create worker
export const replyMonitorWorker = new Worker<MonitorJobData>(
  'reply-monitor',
  processMonitorJob,
  {
    connection,
    concurrency: 5, // Process up to 5 tenants in parallel
  }
);

// Error handling
replyMonitorWorker.on('failed', (job, err) => {
  console.error(`[Monitor] Job ${job?.id} failed:`, err);
});

replyMonitorWorker.on('completed', (job, result) => {
  console.log(
    `[Monitor] Job ${job.id} completed: ${result.processed} processed, ${result.posted} posted`
  );
});

/**
 * Schedule monitoring jobs for all active tenants
 * Should be called periodically (e.g., every minute via cron)
 */
export async function scheduleMonitoringJobs(): Promise<number> {
  const tenantService = getTenantService();
  const activeTenants = await tenantService.getActiveTenants();

  let scheduled = 0;

  for (const tenant of activeTenants) {
    // Check if a job for this tenant is already in progress
    const existingJobs = await replyMonitorQueue.getJobs(['active', 'waiting']);
    const hasExisting = existingJobs.some(
      (j) =>
        j.data.accountId === tenant.accountId &&
        j.data.threadsAccountId === tenant.threadsAccountId
    );

    if (!hasExisting) {
      await replyMonitorQueue.add(
        'monitor',
        {
          accountId: tenant.accountId,
          threadsAccountId: tenant.threadsAccountId,
        },
        {
          jobId: `monitor:${tenant.threadsAccountId}:${Date.now()}`,
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );
      scheduled++;
    }
  }

  console.log(`[Monitor] Scheduled ${scheduled} jobs for ${activeTenants.length} tenants`);
  return scheduled;
}
