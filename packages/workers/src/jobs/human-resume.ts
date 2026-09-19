/**
 * Human Resume Job
 *
 * The async half of human-in-the-loop inference (PLAN step 2). The monitor
 * never blocks on a human answer: it enqueues a `classify` (then `respond`)
 * inference row and exits. This job runs on its own bounded cron, atomically
 * consumes answered rows, and continues the correct workflow stage:
 *
 *   classify answered -> run post-classification checks ->
 *     proceed  -> enqueue a `respond` inference (human writes the reply text)
 *     skipped  -> release the per-reply claim, record nothing further
 *   respond answered  -> deliver via the approval queue or the two-key
 *     auto-post gate, then release the per-reply claim
 *
 * Exactly-once: `claimAnsweredInference` flips pending->processing in a
 * single UPDATE, so only one consumer ever processes a row. Late or
 * duplicate answers are rejected by `claimAnsweredInference` (they only
 * match status='answered'). Claims are released exactly once per row:
 * terminal stages release on completion; expired rows are reaped and their
 * claims released so the next monitor tick can re-examine the reply.
 *
 * The resume job runs with the human-bypass flag set: if any code path
 * here ever reaches generateWithFallback with HUMAN_INFERENCE_ENABLED on,
 * it must NOT re-enqueue into the human queue (that would deadlock the
 * cron). It uses LLM generation instead.
 */

import {
  ThreadsClient, getDb, ConversationContext, validateAnswer,
  claimAnsweredInference, reapExpiredInference, releaseScope, enqueueHumanInference,
} from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';
import {
  ProcessReplyCtx, IncomingReply, ClassificationInput,
  checkClassification, deliverResponse,
} from './reply-monitor.js';
import { setHumanBypass } from '../utils/llm-provider.js';

interface ReplyPayloadBase {
  stage: 'classify' | 'respond';
  claimScope: string;
  accountId: string;
  threadsAccountId: string;
  requireApproval?: boolean;
  targetClassifications?: string[];
  parentPost: { id: string; text: string };
  reply: { id: string; text: string; username: string; timestamp?: string };
  conversation?: ConversationContext;
}

interface ClassifyPayload extends ReplyPayloadBase {
  stage: 'classify';
}

interface RespondPayload extends ReplyPayloadBase {
  stage: 'respond';
  classification: ClassificationInput;
}

function isClassifyPayload(p: unknown): p is ClassifyPayload {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    o.stage === 'classify' &&
    typeof o.claimScope === 'string' &&
    typeof o.accountId === 'string' &&
    typeof o.threadsAccountId === 'string' &&
    typeof o.parentPost === 'object' && o.parentPost !== null &&
    typeof (o.parentPost as Record<string, unknown>).id === 'string' &&
    typeof o.reply === 'object' && o.reply !== null &&
    typeof (o.reply as Record<string, unknown>).id === 'string'
  );
}

function isRespondPayload(p: unknown): p is RespondPayload {
  if (!isClassifyPayload(p)) return false;
  const o = p as unknown as Record<string, unknown>;
  if (o.stage !== 'respond') return false;
  const c = o.classification as Record<string, unknown> | undefined;
  return (
    typeof c === 'object' && c !== null &&
    typeof c.classification === 'string' &&
    typeof c.confidence === 'number'
  );
}

function recordSkipHistory(
  accountId: string,
  parentPostId: string,
  reply: { id: string; username: string; text: string },
  cls: ClassificationInput | null
): void {
  const db = getDb();
  const fp = db
    .prepare('SELECT id FROM focused_posts WHERE account_id = ? AND threads_post_id = ?')
    .get(accountId, parentPostId) as { id: string } | undefined;
  if (!fp) return;
  db.prepare(`
    INSERT OR IGNORE INTO reply_history
      (account_id, focused_post_id, threads_reply_id, replier_username, reply_text,
       classification, confidence, our_response, our_reply_id, replied)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0)
  `).run(
    accountId, fp.id, reply.id, reply.username, reply.text,
    cls?.classification ?? 'skip', cls?.confidence ?? 1
  );
}

function buildResumeCtx(
  accountId: string,
  threadsAccountId: string,
  requireApproval: boolean | undefined,
  targetClassifications: string[] | undefined,
  parentPost: { id: string; text: string }
): ProcessReplyCtx | null {
  const tenantService = getTenantService();
  const config = tenantService.getTenantConfig(accountId);
  if (!config) {
    console.error(`[Resume] No tenant config for ${accountId}`);
    return null;
  }
  const credentials = tenantService.getThreadsCredentials(threadsAccountId);
  if (!credentials) {
    console.error(`[Resume] No credentials for ${threadsAccountId}`);
    return null;
  }
  return {
    accountId,
    threadsAccountId,
    ownUsername: credentials.username,
    client: new ThreadsClient({ accessToken: credentials.accessToken, userId: credentials.userId }),
    parentPost,
    requireApproval: requireApproval ?? config.requireApproval,
    targetClassifications,
    voiceSettings: config.voiceSettings,
    voiceExamples: tenantService.getVoiceExamples(accountId),
    friends: config.friends,
  };
}

async function resumeClassify(
  inferenceId: string,
  payload: ClassifyPayload,
  answer: unknown
): Promise<void> {
  let cls: ClassificationInput;
  try {
    const canonical = validateAnswer('classify', answer);
    cls = JSON.parse(canonical) as ClassificationInput;
  } catch (error) {
    console.error(`[Resume] Invalid classify answer on inference ${inferenceId}:`, error);
    releaseScope(payload.claimScope);
    return;
  }

  const ctx = buildResumeCtx(
    payload.accountId, payload.threadsAccountId,
    payload.requireApproval, payload.targetClassifications,
    payload.parentPost
  );
  if (!ctx) {
    releaseScope(payload.claimScope);
    return;
  }

  const reply = payload.reply as IncomingReply;
  const checked = checkClassification(ctx, reply, cls);
  if (checked) {
    // Terminal skip: record it and release the claim exactly once.
    recordSkipHistory(payload.accountId, payload.parentPost.id, reply, cls);
    console.log(`[Resume] Inference ${inferenceId} classify answer skipped reply ${reply.id}: ${checked.error}`);
    releaseScope(payload.claimScope);
    return;
  }

  // Proceed to the response stage: enqueue `respond` inference and exit.
  // The per-reply claim stays held until the respond stage completes, so
  // no monitor tick re-enqueues this reply in the meantime.
  const respondId = enqueueHumanInference('respond', {
    stage: 'respond',
    claimScope: payload.claimScope,
    accountId: payload.accountId,
    threadsAccountId: payload.threadsAccountId,
    requireApproval: ctx.requireApproval,
    targetClassifications: payload.targetClassifications,
    parentPost: payload.parentPost,
    reply: payload.reply,
    conversation: payload.conversation,
    classification: cls,
  } satisfies Omit<RespondPayload, 'stage'> & { stage: 'respond' });
  console.log(`[Resume] Inference ${inferenceId} classified as ${cls.classification}; enqueued respond inference ${respondId} for reply ${reply.id}`);
}

async function resumeRespond(
  inferenceId: string,
  payload: RespondPayload,
  answer: unknown
): Promise<void> {
  let text: string;
  try {
    text = validateAnswer('respond', answer);
  } catch (error) {
    console.error(`[Resume] Invalid respond answer on inference ${inferenceId}:`, error);
    releaseScope(payload.claimScope);
    return;
  }

  const ctx = buildResumeCtx(
    payload.accountId, payload.threadsAccountId,
    payload.requireApproval, payload.targetClassifications,
    payload.parentPost
  );
  if (!ctx) {
    releaseScope(payload.claimScope);
    return;
  }

  const reply = payload.reply as IncomingReply;
  try {
    const result = await deliverResponse(ctx, reply, payload.classification, text, payload.conversation);
    console.log(
      `[Resume] Inference ${inferenceId} delivered reply ${reply.id}: ` +
      (result.posted ? `posted (${result.postId})` : result.error ? `error: ${result.error}` : 'queued for approval')
    );
  } finally {
    // Claim released exactly once, on every path out of the terminal stage.
    releaseScope(payload.claimScope);
  }
}

export async function resumeHumanInference(): Promise<{ resumed: number; reaped: number }> {
  // Defensive: nothing in this job should ever re-enqueue into the human
  // queue. If a future refactor routes through generateWithFallback here,
  // the bypass forces real LLM generation instead of deadlocking the cron.
  setHumanBypass(true);
  try {
    let resumed = 0;

    for (;;) {
      const claimed = claimAnsweredInference();
      if (!claimed) break;
      resumed++;

      // claimAnsweredInference already JSON.parsed payload and answer.
      const payload = claimed.payload;

      try {
        if (isRespondPayload(payload)) {
          await resumeRespond(claimed.id, payload, claimed.answer);
        } else if (isClassifyPayload(payload)) {
          await resumeClassify(claimed.id, payload, claimed.answer);
        } else {
          console.error(`[Resume] Inference ${claimed.id} has malformed payload; releasing claim`);
          const scope = (payload as { claimScope?: unknown }).claimScope;
          if (typeof scope === 'string') releaseScope(scope);
        }
      } catch (error) {
        console.error(`[Resume] Error resuming inference ${claimed.id}:`, error);
        const scope = (payload as { claimScope?: unknown }).claimScope;
        if (typeof scope === 'string') releaseScope(scope);
      }
    }

    // Reap expired rows: reapExpiredInference transitions them to the
    // terminal `resumed` state and releases their claims internally, so the
    // next monitor tick can re-examine the reply (mirrors the old sync
    // timeout -> retry behavior).
    const reaped = reapExpiredInference();
    if (reaped.length > 0) {
      console.log(`[Resume] Reaped ${reaped.length} expired inference rows`);
    }

    return { resumed, reaped: reaped.length };
  } finally {
    setHumanBypass(false);
  }
}
