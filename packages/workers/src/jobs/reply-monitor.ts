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
import { ThreadsClient, ClassificationType } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';
import { classifyReply, Classification } from '../utils/classifier.js';
import { generateResponse, ResponseContext } from '../utils/responder.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  createEvaluatorsOrchestrator,
  type EvaluatorsOrchestrator,
} from '../evaluators/index.js';

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

// Maximum conversation depth for nested replies (3 deep max)
const MAX_CONVERSATION_DEPTH = 3;

// Maximum age for comments we'll reply to (24 hours in milliseconds)
const MAX_COMMENT_AGE_MS = 24 * 60 * 60 * 1000;

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
 * Check if a comment is too old to reply to (> 24 hours)
 */
function isCommentTooOld(timestamp: string): boolean {
  try {
    const commentDate = new Date(timestamp);
    const ageMs = Date.now() - commentDate.getTime();
    return ageMs > MAX_COMMENT_AGE_MS;
  } catch {
    // If we can't parse timestamp, assume it's old to be safe
    return true;
  }
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
    targetClassifications?: ClassificationType[];
    orchestrator?: EvaluatorsOrchestrator;
  },
  reply: { id: string; text: string; username: string; timestamp?: string; mediaType?: string }
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

  // Skip if classification doesn't match target classifications for this post
  if (
    ctx.targetClassifications &&
    ctx.targetClassifications.length > 0 &&
    !ctx.targetClassifications.includes(classificationResult.classification as ClassificationType)
  ) {
    console.log(
      `[Monitor] Skipping @${reply.username} - classification=${classificationResult.classification} not in targets [${ctx.targetClassifications.join(', ')}]`
    );
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      response: null,
      posted: false,
      postId: null,
      error: `Not in target classifications: ${ctx.targetClassifications.join(', ')}`,
    };
  }

  // Run evaluator checks (bot loop, cooldowns, blocklist)
  if (ctx.orchestrator) {
    try {
      const evalResult = await ctx.orchestrator.evaluate({
        replyId: reply.id,
        username: reply.username,
        threadId: ctx.parentPost.id,
        text: reply.text,
        timestamp: reply.timestamp ? new Date(reply.timestamp) : new Date(),
        classification: classificationResult.classification,
        confidence: classificationResult.confidence,
        hasMedia: reply.mediaType !== undefined && reply.mediaType !== 'TEXT',
        mediaType: reply.mediaType,
      });
      if (!evalResult.shouldReply) {
        console.log(`[Monitor] Evaluator blocked @${reply.username}: ${evalResult.reason}`);
        return {
          replyId: reply.id,
          username: reply.username,
          text: reply.text,
          classification: classificationResult.classification,
          confidence: classificationResult.confidence,
          response: null,
          posted: false,
          postId: null,
          error: `Evaluator: ${evalResult.reason}`,
        };
      }
    } catch (error) {
      console.error('[Monitor] Evaluator error, proceeding anyway:', error);
      // FAIL OPEN — evaluators are safety layers, not gates
    }
  }

  // Skip neutral only if VERY low confidence (classifier is uncertain)
  // Lowered from 0.7 to 0.3 - respond to more neutral comments
  if (
    classificationResult.classification === 'neutral' &&
    classificationResult.confidence < 0.3
  ) {
    console.log(`[Monitor] Skipping @${reply.username} - classification=${classificationResult.classification}, confidence=${classificationResult.confidence.toFixed(2)}, reason: very low confidence`);
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: classificationResult.classification,
      confidence: classificationResult.confidence,
      response: null,
      posted: false,
      postId: null,
      error: `classification=${classificationResult.classification}, confidence=${classificationResult.confidence.toFixed(2)}, reason: very low confidence`,
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

    if (posted.success && posted.replyId) {
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
          postId: posted.replyId,
        },
        Date.now() - startTime,
        generatedResponse.source
      );

      // Track reply in evaluators (fire-and-forget)
      if (ctx.orchestrator) {
        try {
          await ctx.orchestrator.trackReply({
            ourReplyId: posted.replyId,
            ourReplyText: generatedResponse.reply,
            hostileId: reply.id,
            hostileText: reply.text,
            hostileUser: reply.username,
            threadId: ctx.parentPost.id,
            classification: classificationResult.classification,
          });
        } catch (error) {
          console.error('[Monitor] Failed to track reply:', error);
        }
      }

      return {
        replyId: reply.id,
        username: reply.username,
        text: reply.text,
        classification: classificationResult.classification,
        confidence: classificationResult.confidence,
        response: generatedResponse.reply,
        posted: true,
        postId: posted.replyId,
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

  // Create evaluators orchestrator
  let orchestrator: EvaluatorsOrchestrator | undefined;
  try {
    orchestrator = createEvaluatorsOrchestrator(SUPABASE_URL, SUPABASE_SERVICE_KEY, accountId);
  } catch (error) {
    console.error('[Monitor] Failed to create evaluators orchestrator, proceeding without:', error);
  }

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
      const repliesResult = await client.getPostReplies(focusedPost.post_id, 50);

      if (!repliesResult.success || !repliesResult.replies || repliesResult.replies.length === 0) {
        continue;
      }

      const replies = repliesResult.replies;
      console.log(
        `[Monitor] Found ${replies.length} replies on post ${focusedPost.post_id}`
      );

      // Track our replies that have sub-replies (for nested monitoring)
      // NOTE: Our replies are at LEVEL 2 (replies to hostile comments), not LEVEL 1
      const ourRepliesWithSubReplies: Array<{ id: string; depth: number }> = [];

      // Track hostile comments with sub-replies - we need to check if we replied to them
      const hostileCommentsWithReplies: string[] = [];

      // Process each reply (level 1 - direct replies to post)
      for (const reply of replies) {
        // Track hostile comments that have sub-replies (might contain our replies)
        if (!reply.isReplyOwnedByMe && reply.hasReplies) {
          hostileCommentsWithReplies.push(reply.id);
        }

        // Skip if it's the post owner's reply (our own)
        if (reply.isReplyOwnedByMe) {
          continue;
        }

        // Skip if comment is older than 24 hours
        if (isCommentTooOld(reply.timestamp)) {
          const ageHours = Math.floor((Date.now() - new Date(reply.timestamp).getTime()) / (1000 * 60 * 60));
          console.log(`[Monitor] Skipping old comment from @${reply.username} (${ageHours}h old)`);
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
            targetClassifications: focusedPost.target_classifications,
            orchestrator,
          },
          {
            id: reply.id,
            text: reply.text,
            username: reply.username,
            timestamp: reply.timestamp,
            mediaType: reply.mediaType,
          }
        );

        totalProcessed++;
        if (result.posted) {
          totalPosted++;
        }

        // Small delay between replies to avoid rate limiting
        await new Promise((r) => setTimeout(r, 2000));
      }

      // CRITICAL FIX: Fetch sub-replies of hostile comments to find OUR replies
      // Our replies exist at LEVEL 2 (replies to hostile comments), not LEVEL 1
      if (hostileCommentsWithReplies.length > 0) {
        console.log(`[Monitor] Checking ${hostileCommentsWithReplies.length} hostile comments for our nested replies...`);

        for (const hostileCommentId of hostileCommentsWithReplies) {
          // Fetch sub-replies to find our responses
          const subRepliesResult = await client.getPostReplies(hostileCommentId, 20);
          if (!subRepliesResult.success || !subRepliesResult.replies) continue;

          for (const subReply of subRepliesResult.replies) {
            // Found one of OUR replies - check if it has responses (nested hostile)
            if (subReply.isReplyOwnedByMe && subReply.hasReplies) {
              console.log(`[Monitor] Found our reply ${subReply.id} with nested replies - adding to nested processing`);
              ourRepliesWithSubReplies.push({ id: subReply.id, depth: 2 });
            }
          }
        }
      }

      // Process nested replies (replies to our replies) up to MAX_CONVERSATION_DEPTH
      if (ourRepliesWithSubReplies.length > 0) {
        console.log(`[Monitor] Checking ${ourRepliesWithSubReplies.length} nested conversations...`);

        for (const ourReply of ourRepliesWithSubReplies) {
          if (ourReply.depth >= MAX_CONVERSATION_DEPTH) {
            console.log(`[Monitor] Skipping nested reply at depth ${ourReply.depth} (max: ${MAX_CONVERSATION_DEPTH})`);
            continue;
          }

          // Fetch replies to our reply
          const nestedResult = await client.getPostReplies(ourReply.id, 10);
          if (!nestedResult.success || !nestedResult.replies) continue;

          for (const nestedReply of nestedResult.replies) {
            // Skip our own replies
            if (nestedReply.isReplyOwnedByMe) {
              // Track deeper nesting if we replied and they replied back
              if (nestedReply.hasReplies && ourReply.depth + 1 < MAX_CONVERSATION_DEPTH) {
                ourRepliesWithSubReplies.push({ id: nestedReply.id, depth: ourReply.depth + 1 });
              }
              continue;
            }

            // Skip if nested comment is older than 24 hours
            if (isCommentTooOld(nestedReply.timestamp)) {
              const ageHours = Math.floor((Date.now() - new Date(nestedReply.timestamp).getTime()) / (1000 * 60 * 60));
              console.log(`[Monitor] Skipping old nested comment from @${nestedReply.username} (${ageHours}h old)`);
              continue;
            }

            // Process nested hostile reply
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
                targetClassifications: focusedPost.target_classifications,
                orchestrator,
              },
              {
                id: nestedReply.id,
                text: nestedReply.text,
                username: nestedReply.username,
                timestamp: nestedReply.timestamp,
                mediaType: nestedReply.mediaType,
              }
            );

            totalProcessed++;
            if (result.posted) {
              totalPosted++;
              console.log(`[Monitor] Replied to nested comment at depth ${ourReply.depth + 1}`);
            }

            // Small delay between replies
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
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
