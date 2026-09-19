/**
 * Reply Monitor Job
 *
 * Per-tenant job that:
 * 1. Fetches replies on focused posts
 * 2. Builds the verified conversation context for each reply (obs#17031)
 * 3. Classifies each reply / generates responses
 * 4. Records history for analytics
 *
 * Step 2 (async HIL): the monitor NEVER blocks on a human answer. When
 * HUMAN_INFERENCE_ENABLED=true it enqueues inference and exits; the resume
 * job (jobs/human-resume.ts) continues the workflow when answered.
 *
 * Concurrency: DB-backed claims (processing_claims) replace the old
 * in-process runningAccounts guard and the read-before-work
 * hasProcessedReply check, so concurrent workers can't duplicate work.
 */

import {
  ThreadsClient, ClassificationType, getDb, VoiceSettings, VoiceExample, Friend,
  ConversationContext, buildConversationContext, summarizeConversation,
  claimScope, releaseScope, tickScope, replyScope, TICK_LEASE_TTL_MS,
  enqueueHumanInference,
} from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';
import { classifyReply, Classification } from '../utils/classifier.js';
import { generateResponse, ResponseContext } from '../utils/responder.js';
import { isHumanEnabled } from '../utils/llm-provider.js';

export interface MonitorJobData {
  accountId: string;
  threadsAccountId: string;
}

export interface ProcessedReply {
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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Maximum conversation depth for nested replies
const MAX_CONVERSATION_DEPTH = 3;

// Maximum age for comments we'll reply to
const MAX_COMMENT_AGE_MS = 24 * 60 * 60 * 1000;

function isCommentTooOld(timestamp: string): boolean {
  try {
    return Date.now() - new Date(timestamp).getTime() > MAX_COMMENT_AGE_MS;
  } catch {
    return true;
  }
}

function recordReplyHistory(
  accountId: string,
  parentPostId: string,
  processed: ProcessedReply
): void {
  const db = getDb();

  // Resolve the focused_post UUID from the Threads post ID
  const fp = db
    .prepare('SELECT id FROM focused_posts WHERE account_id = ? AND threads_post_id = ?')
    .get(accountId, parentPostId) as { id: string } | undefined;

  if (!fp) {
    console.warn(`[Monitor] No focused_post found for post ${parentPostId}, skipping history`);
    return;
  }

  db.prepare(`
    INSERT OR IGNORE INTO reply_history
      (account_id, focused_post_id, threads_reply_id, replier_username, reply_text,
       classification, confidence, our_response, our_reply_id, replied)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    accountId,
    fp.id,
    processed.replyId,
    processed.username,
    processed.text,
    processed.classification,
    processed.confidence,
    processed.response ?? null,
    processed.postId ?? null,
    processed.posted ? 1 : 0
  );
}

/** Our prior replies in a focused-post thread, from structured history. */
function getOurPriorReplies(accountId: string, parentPostId: string): Array<{ id: string; text: string }> {
  const db = getDb();
  const fp = db
    .prepare('SELECT id FROM focused_posts WHERE account_id = ? AND threads_post_id = ?')
    .get(accountId, parentPostId) as { id: string } | undefined;
  if (!fp) return [];
  return db.prepare(
    `SELECT our_reply_id AS id, our_response AS text FROM reply_history
     WHERE account_id = ? AND focused_post_id = ? AND replied = 1 AND our_response IS NOT NULL
     ORDER BY rowid DESC LIMIT 5`
  ).all(accountId, fp.id) as Array<{ id: string; text: string }>;
}

export interface ProcessReplyCtx {
  accountId: string;
  requireApproval?: boolean;
  threadsAccountId: string;
  ownUsername: string | null;
  client: ThreadsClient;
  parentPost: { id: string; text: string };
  voiceSettings: VoiceSettings | null;
  voiceExamples: VoiceExample[];
  friends: Friend[];
  targetClassifications?: string[];
}

export type IncomingReply = {
  id: string; text: string; username: string; timestamp?: string; mediaType?: string;
  repliedToId?: string; rootPostId?: string; isReplyOwnedByMe: boolean;
};

export async function processReply(
  ctx: ProcessReplyCtx,
  reply: IncomingReply
): Promise<ProcessedReply> {
  const skip = (error: string): ProcessedReply => ({
    replyId: reply.id,
    username: reply.username,
    text: reply.text,
    classification: 'skip',
    confidence: 1,
    response: null,
    posted: false,
    postId: null,
    error,
  });

  // Atomic per-reply claim: replaces the old read-before-work
  // hasProcessedReply check. A concurrent worker racing here gets a clean
  // skip instead of duplicating classification/generation.
  const scope = replyScope(ctx.accountId, reply.id);
  if (!claimScope(scope)) {
    return skip('Already claimed by another worker');
  }

  try {
    if (ctx.ownUsername?.toLowerCase() === reply.username.toLowerCase()) {
      releaseScope(scope);
      return skip('Own reply');
    }

    // Step 3 (obs#17031): verify the conversation tree from the API's own
    // replied_to linkage. Missing or ambiguous parentage is a hard skip —
    // we never infer parentage from traversal, timestamps, or mentions.
    const built = await buildConversationContext(
      ctx.client,
      ctx.parentPost,
      {
        id: reply.id,
        text: reply.text,
        username: reply.username,
        timestamp: reply.timestamp,
        isReplyOwnedByMe: reply.isReplyOwnedByMe,
        repliedToId: reply.repliedToId,
        rootPostId: reply.rootPostId,
      },
      getOurPriorReplies(ctx.accountId, ctx.parentPost.id)
    );
    if (!built.ok) {
      console.log(`[Monitor] Skipping reply ${reply.id}: ${built.reason}`);
      releaseScope(scope);
      return skip(`Unverifiable conversation: ${built.reason}`);
    }
    const conversation = built.context;
    console.log(`[Monitor] Reply ${reply.id}: ${summarizeConversation(conversation)}`);

    if (conversation.depth > MAX_CONVERSATION_DEPTH) {
      releaseScope(scope);
      return skip(`Conversation depth ${conversation.depth} exceeds max ${MAX_CONVERSATION_DEPTH}`);
    }

    // Async HIL: enqueue classification and exit. The resume job continues
    // the workflow when the operator answers. The cron tick is never held.
    if (isHumanEnabled()) {
      const inferenceId = enqueueHumanInference('classify', {
        stage: 'classify',
        claimScope: scope,
        accountId: ctx.accountId,
        threadsAccountId: ctx.threadsAccountId,
        requireApproval: ctx.requireApproval,
        targetClassifications: ctx.targetClassifications,
        parentPost: ctx.parentPost,
        reply: { id: reply.id, text: reply.text, username: reply.username, timestamp: reply.timestamp },
        conversation,
      });
      console.log(`[Monitor] Enqueued classify inference ${inferenceId} for reply ${reply.id}; exiting`);
      // Claim is intentionally NOT released here: it is held until the
      // resume job finishes the workflow (or the reaper releases it on
      // expiry), so no other tick re-enqueues this reply.
      return {
        replyId: reply.id,
        username: reply.username,
        text: reply.text,
        classification: 'skip',
        confidence: 1,
        response: null,
        posted: false,
        postId: null,
        error: `Awaiting human classification (inference ${inferenceId})`,
      };
    }

    const result = await runReplyWorkflow(ctx, conversation, reply, null);
    releaseScope(scope);
    return result;
  } catch (error) {
    releaseScope(scope);
    throw error;
  }
}

export interface ClassificationInput {
  classification: Classification;
  confidence: number;
  reasoning: string;
  injectionDetected?: boolean;
  isMetaComment?: boolean;
}


/**
 * Post-classification checks shared by the monitor (LLM path) and the
 * resume job (human-answer path). Returns a skip result when the reply
 * should not proceed, or null when the workflow may continue.
 */
export function checkClassification(
  ctx: ProcessReplyCtx,
  reply: IncomingReply,
  cls: ClassificationInput
): ProcessedReply | null {
  const skipResult = (error: string): ProcessedReply => ({
    replyId: reply.id,
    username: reply.username,
    text: reply.text,
    classification: cls.classification,
    confidence: cls.confidence,
    response: null,
    posted: false,
    postId: null,
    error,
  });

  if (cls.classification === 'skip') {
    return skipResult(cls.reasoning || 'skipped');
  }

  if (cls.injectionDetected) {
    return skipResult('Injection detected');
  }

  if (
    ctx.targetClassifications &&
    ctx.targetClassifications.length > 0 &&
    !ctx.targetClassifications.includes(cls.classification as ClassificationType)
  ) {
    console.log(
      `[Monitor] Skipping @${reply.username} - classification=${cls.classification} not in targets [${ctx.targetClassifications.join(', ')}]`
    );
    return skipResult(`Not in target classifications: ${ctx.targetClassifications.join(', ')}`);
  }

  // Skip very-low-confidence neutral (classifier is uncertain)
  if (cls.classification === 'neutral' && cls.confidence < 0.3) {
    console.log(
      `[Monitor] Skipping @${reply.username} - neutral, confidence=${cls.confidence.toFixed(2)} too low`
    );
    return skipResult(
      `classification=${cls.classification}, confidence=${cls.confidence.toFixed(2)}, reason: very low confidence`
    );
  }

  return null;
}

/**
 * Deliver a generated (or human-written) response: queue for approval by
 * default, or post when the two-key auto-post system is engaged
 * (requireApproval=false AND THREADS_AUTO_POST=true). Fail-closed always.
 */
export async function deliverResponse(
  ctx: ProcessReplyCtx,
  reply: IncomingReply,
  cls: ClassificationInput,
  responseText: string,
  conversation?: ConversationContext
): Promise<ProcessedReply> {
  const base: Omit<ProcessedReply, 'posted' | 'postId' | 'error'> = {
    replyId: reply.id,
    username: reply.username,
    text: reply.text,
    classification: cls.classification,
    confidence: cls.confidence,
    response: responseText,
  };

  // Auto-post is a two-key system: the DB setting alone is never enough.
  // requireApproval=false must be paired with THREADS_AUTO_POST=true or the
  // reply still goes to the approval queue. Default is always fail-closed.
  const autoPost = ctx.requireApproval === false && process.env.THREADS_AUTO_POST === 'true';
  if (!autoPost) {
    const queued = getDb().prepare(`INSERT OR IGNORE INTO pending_replies
      (account_id, threads_account_id, threads_reply_id, payload, response)
      VALUES (?, ?, ?, ?, ?)`).run(ctx.accountId, ctx.threadsAccountId, reply.id,
        JSON.stringify({ parentPost: ctx.parentPost, reply, classification: cls, conversation }), responseText);
    if (queued.changes === 0) {
      console.log(`[Monitor] Reply ${reply.id} already queued (concurrent worker raced here)`);
    }
    return { ...base, posted: false, postId: null };
  }

  console.warn(`[Monitor] AUTO-POST ENGAGED for @${reply.username} (requireApproval=false + THREADS_AUTO_POST=true)`);

  try {
    const posted = await ctx.client.replyToPost(reply.id, responseText);

    if (posted.success && posted.replyId) {
      console.log(
        `Posted reply to @${reply.username}: "${responseText.substring(0, 50)}..."`
      );
      const result: ProcessedReply = { ...base, posted: true, postId: posted.replyId };
      recordReplyHistory(ctx.accountId, ctx.parentPost.id, result);
      return result;
    }
  } catch (error) {
    console.error(`Failed to post reply to @${reply.username}:`, error);
  }

  const result: ProcessedReply = { ...base, posted: false, postId: null, error: 'Post failed' };
  recordReplyHistory(ctx.accountId, ctx.parentPost.id, result);
  return result;
}

/**
 * Shared reply workflow used by the monitor (LLM path). Runs classification
 * (unless provided, as the resume job does), post-classification checks,
 * response generation, then delivery via the approval queue or auto-post.
 */
export async function runReplyWorkflow(
  ctx: ProcessReplyCtx,
  conversation: ConversationContext,
  reply: IncomingReply,
  classification: ClassificationInput | null
): Promise<ProcessedReply> {
  let cls = classification;
  if (!cls) {
    cls = await classifyReply(
      ctx.parentPost.text,
      reply.text,
      reply.username,
      OPENROUTER_API_KEY,
      undefined,
      {
        accountId: ctx.accountId,
        threadsAccountId: ctx.threadsAccountId,
        replyId: reply.id,
        parentPostId: ctx.parentPost.id,
        conversation,
      }
    );
  }

  const checked = checkClassification(ctx, reply, cls);
  if (checked) return checked;

  const responseCtx: ResponseContext = {
    accountId: ctx.accountId,
    threadsAccountId: ctx.threadsAccountId,
    replyId: reply.id,
    parentPostId: ctx.parentPost.id,
    originalPost: ctx.parentPost.text,
    replyText: reply.text,
    username: reply.username,
    classification: cls.classification,
    voiceSettings: ctx.voiceSettings,
    voiceExamples: ctx.voiceExamples,
    friends: ctx.friends,
    isMetaComment: cls.isMetaComment,
    confidence: cls.confidence,
    previousRepliesInThread: conversation.ourPriorReplies.map(r => r.text),
    conversation,
  };

  const generatedResponse = await generateResponse(responseCtx, OPENROUTER_API_KEY);

  if (!generatedResponse.reply) {
    return {
      replyId: reply.id,
      username: reply.username,
      text: reply.text,
      classification: cls.classification,
      confidence: cls.confidence,
      response: null,
      posted: false,
      postId: null,
      error: 'Generation failed',
    };
  }

  return deliverResponse(ctx, reply, cls, generatedResponse.reply, conversation);
}

export async function runReplyMonitor(accountId: string, threadsAccountId: string): Promise<{ processed: number; posted: number }> {
  // DB-backed tick lease replaces the in-process runningAccounts guard, so
  // overlapping cron ticks can't run the same account concurrently even
  // across worker processes.
  if (!claimScope(tickScope(accountId), TICK_LEASE_TTL_MS)) {
    console.log(`[Monitor] Tick for ${accountId} already running elsewhere; skipping`);
    return { processed: 0, posted: 0 };
  }
  try {
    return await monitorAccount(accountId, threadsAccountId);
  } finally {
    releaseScope(tickScope(accountId));
  }
}

async function monitorAccount(
  accountId: string,
  threadsAccountId: string
): Promise<{ processed: number; posted: number }> {
  console.log(`[Monitor] Processing tenant ${accountId}`);

  const tenantService = getTenantService();

  const config = tenantService.getTenantConfig(accountId);
  if (!config) {
    console.error(`[Monitor] Failed to load config for tenant ${accountId}`);
    return { processed: 0, posted: 0 };
  }

  const credentials = tenantService.getThreadsCredentials(threadsAccountId);
  if (!credentials) {
    console.error(`[Monitor] Failed to load credentials for ${threadsAccountId}`);
    return { processed: 0, posted: 0 };
  }

  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  const focusedPosts = tenantService.getFocusedPosts(threadsAccountId);
  if (focusedPosts.length === 0) {
    console.log(`[Monitor] No focused posts for ${threadsAccountId}`);
    return { processed: 0, posted: 0 };
  }

  const voiceExamples = tenantService.getVoiceExamples(accountId);

  // Shared context fields constant across all replies for this run
  const baseCtx: Omit<ProcessReplyCtx, 'parentPost'> = {
    accountId,
    threadsAccountId,
    ownUsername: credentials.username,
    client,
    requireApproval: config.requireApproval,
    voiceSettings: config.voiceSettings,
    voiceExamples,
    friends: config.friends,
  };

  let totalProcessed = 0;
  let totalPosted = 0;

  for (const focusedPost of focusedPosts) {
    const postId = focusedPost.threads_post_id;
    const postText = focusedPost.post_text || '';
    const parentPost = { id: postId, text: postText };

    try {
      const repliesResult = await client.getPostReplies(postId, 50);

      if (!repliesResult.success || !repliesResult.replies?.length) {
        continue;
      }

      const replies = repliesResult.replies;
      console.log(`[Monitor] Found ${replies.length} replies on post ${postId}`);

      const ourRepliesWithSubReplies: Array<{ id: string; depth: number }> = [];
      const hostileCommentsWithReplies: string[] = [];

      for (const reply of replies) {
        if (!reply.isReplyOwnedByMe && reply.hasReplies) {
          hostileCommentsWithReplies.push(reply.id);
        }

        if (reply.isReplyOwnedByMe) continue;

        if (isCommentTooOld(reply.timestamp)) {
          const ageHours = Math.floor(
            (Date.now() - new Date(reply.timestamp).getTime()) / (1000 * 60 * 60)
          );
          console.log(`[Monitor] Skipping old comment from @${reply.username} (${ageHours}h old)`);
          continue;
        }

        const result = await processReply(
          { ...baseCtx, parentPost },
          {
            id: reply.id, text: reply.text, username: reply.username,
            timestamp: reply.timestamp, mediaType: reply.mediaType,
            repliedToId: reply.repliedToId, rootPostId: reply.rootPostId,
            isReplyOwnedByMe: reply.isReplyOwnedByMe,
          }
        );

        totalProcessed++;
        if (result.posted) totalPosted++;

        await new Promise((r) => setTimeout(r, 2000));
      }

      // Find our nested replies inside hostile comment threads
      if (hostileCommentsWithReplies.length > 0) {
        console.log(
          `[Monitor] Checking ${hostileCommentsWithReplies.length} hostile comments for our nested replies...`
        );

        for (const hostileCommentId of hostileCommentsWithReplies) {
          const subRepliesResult = await client.getPostReplies(hostileCommentId, 20);
          if (!subRepliesResult.success || !subRepliesResult.replies) continue;

          for (const subReply of subRepliesResult.replies) {
            if (subReply.isReplyOwnedByMe && subReply.hasReplies) {
              console.log(
                `[Monitor] Found our reply ${subReply.id} with nested replies - adding to nested processing`
              );
              ourRepliesWithSubReplies.push({ id: subReply.id, depth: 2 });
            }
          }
        }
      }

      // Process nested replies (replies to our replies) up to MAX_CONVERSATION_DEPTH.
      // Each candidate's parentage is verified against the API's replied_to
      // linkage inside processReply — discovery by traversal is only
      // enumeration; placement in the thread is never assumed.
      if (ourRepliesWithSubReplies.length > 0) {
        console.log(
          `[Monitor] Checking ${ourRepliesWithSubReplies.length} nested conversations...`
        );

        for (const ourReply of ourRepliesWithSubReplies) {
          if (ourReply.depth >= MAX_CONVERSATION_DEPTH) {
            console.log(
              `[Monitor] Skipping nested reply at depth ${ourReply.depth} (max: ${MAX_CONVERSATION_DEPTH})`
            );
            continue;
          }

          const nestedResult = await client.getPostReplies(ourReply.id, 10);
          if (!nestedResult.success || !nestedResult.replies) continue;

          for (const nestedReply of nestedResult.replies) {
            if (nestedReply.isReplyOwnedByMe) {
              if (nestedReply.hasReplies && ourReply.depth + 1 < MAX_CONVERSATION_DEPTH) {
                ourRepliesWithSubReplies.push({ id: nestedReply.id, depth: ourReply.depth + 1 });
              }
              continue;
            }

            if (isCommentTooOld(nestedReply.timestamp)) {
              const ageHours = Math.floor(
                (Date.now() - new Date(nestedReply.timestamp).getTime()) / (1000 * 60 * 60)
              );
              console.log(
                `[Monitor] Skipping old nested comment from @${nestedReply.username} (${ageHours}h old)`
              );
              continue;
            }

            const result = await processReply(
              { ...baseCtx, parentPost },
              {
                id: nestedReply.id, text: nestedReply.text, username: nestedReply.username,
                timestamp: nestedReply.timestamp, mediaType: nestedReply.mediaType,
                repliedToId: nestedReply.repliedToId, rootPostId: nestedReply.rootPostId,
                isReplyOwnedByMe: nestedReply.isReplyOwnedByMe,
              }
            );

            totalProcessed++;
            if (result.posted) {
              totalPosted++;
              console.log(`[Monitor] Replied to nested comment at depth ${ourReply.depth + 1}`);
            }

            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }
    } catch (error) {
      console.error(`[Monitor] Error processing post ${postId}:`, error);
    }
  }

  console.log(`[Monitor] Tenant ${accountId}: processed ${totalProcessed}, posted ${totalPosted}`);

  return { processed: totalProcessed, posted: totalPosted };
}

/**
 * Schedule monitoring jobs for all active tenants.
 * Should be called periodically (e.g., every minute via cron).
 */
export async function scheduleMonitoringJobs(): Promise<number> {
  const tenantService = getTenantService();
  const activeTenants = tenantService.getActiveTenants();

  let ran = 0;
  for (const tenant of activeTenants) {
    try {
      await runReplyMonitor(tenant.accountId, tenant.threadsAccountId);
      ran++;
    } catch (error) {
      console.error(`[Monitor] Error running monitor for ${tenant.accountId}:`, error);
    }
  }

  console.log(`[Monitor] Ran monitor for ${ran}/${activeTenants.length} tenants`);
  return ran;
}
