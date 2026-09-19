/**
 * Structured conversation context (Step 3, reverie obs#17031).
 *
 * Every classification/response payload carries the conversation TREE —
 * never a single reply text + root post, and parentage is never inferred
 * from has_replies traversal, timestamps, or mention text. It comes only
 * from the API's own replied_to / root_post linkage, verified hop by hop.
 */

export interface ConversationMessage {
  id: string;
  username: string;
  text: string;
  timestamp?: string;
  isOwnReply: boolean;
}

export interface ConversationContext {
  /** The focused post the monitored thread hangs off. */
  rootPost: { id: string; text: string };
  /** The reply we are deciding about. */
  targetReply: ConversationMessage;
  /** Verified parent chain, root-most first, excluding the target reply. */
  parentChain: ConversationMessage[];
  /** Our own prior replies in this thread (from structured DB history). */
  ourPriorReplies: Array<{ id: string; text: string }>;
  /** parentChain.length + 1 */
  depth: number;
  /** Parentage was verified against the API's replied_to linkage. */
  parentageSource: 'api';
  builtAt: string;
}

/** Minimal reply shape the builder needs from the Threads client. */
export interface ReplyParentage {
  id: string;
  text: string;
  username: string;
  timestamp?: string;
  isReplyOwnedByMe: boolean;
  /** API-provided parent link — the ONLY accepted source of parentage. */
  repliedToId?: string;
  /** API-provided root-post link. */
  rootPostId?: string;
}

/** Minimal client surface the builder needs (subset of ThreadsClient). */
export interface ParentageClient {
  getReplyById(id: string): Promise<{ success: boolean; reply?: ReplyParentage; error?: string }>;
}

export interface OurPriorReply {
  id: string;
  text: string;
}

export type ConversationBuildResult =
  | { ok: true; context: ConversationContext }
  | { ok: false; reason: string };

const MAX_PARENT_HOPS = 6;

/**
 * Build the verified conversation context for a reply.
 *
 * Walks the reply's parent chain via the API's replied_to linkage until it
 * reaches the focused post. Any break — missing replied_to, a failed fetch,
 * a chain that terminates somewhere else, or a cycle — is a hard refusal:
 * the caller must skip with the logged reason, never post.
 */
export async function buildConversationContext(
  client: ParentageClient,
  focusedPost: { id: string; text: string },
  reply: ReplyParentage,
  ourPriorReplies: OurPriorReply[] = []
): Promise<ConversationBuildResult> {
  if (reply.id === focusedPost.id) {
    return { ok: false, reason: `Reply ${reply.id} is the focused post itself` };
  }

  const chain: ConversationMessage[] = [];
  const seen = new Set<string>([reply.id]);
  let current: ReplyParentage = reply;

  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    const parentId = current.repliedToId;
    if (!parentId) {
      // No parent link: only valid if the reply hangs directly off the
      // focused post. But without a replied_to link we cannot verify that —
      // refuse rather than assume.
      return {
        ok: false,
        reason: `Missing parentage: reply ${current.id} has no replied_to link (hop ${hop})`,
      };
    }
    if (seen.has(parentId)) {
      return { ok: false, reason: `Parentage cycle detected at ${parentId}` };
    }
    seen.add(parentId);

    if (parentId === focusedPost.id) {
      // Chain verified: it terminates at the focused post.
      const context: ConversationContext = {
        rootPost: { id: focusedPost.id, text: focusedPost.text },
        targetReply: toMessage(reply),
        parentChain: chain.reverse(),
        ourPriorReplies: ourPriorReplies.slice(0, 5),
        depth: chain.length + 1,
        parentageSource: 'api',
        builtAt: new Date().toISOString(),
      };
      return { ok: true, context };
    }

    const fetched = await client.getReplyById(parentId);
    if (!fetched.success || !fetched.reply) {
      return {
        ok: false,
        reason: `Missing parentage: could not fetch parent ${parentId} (${fetched.error ?? 'no data'})`,
      };
    }
    chain.push(toMessage(fetched.reply));
    current = fetched.reply;
  }

  return { ok: false, reason: `Parent chain exceeded ${MAX_PARENT_HOPS} hops without reaching the focused post` };
}

function toMessage(r: ReplyParentage): ConversationMessage {
  return {
    id: r.id,
    username: r.username,
    text: r.text,
    timestamp: r.timestamp,
    isOwnReply: r.isReplyOwnedByMe,
  };
}

/** One-line summary of a conversation for logs (no full text). */
export function summarizeConversation(ctx: ConversationContext): string {
  const chain = ctx.parentChain.map(m => `${m.username}:${m.id.slice(0, 8)}`).join(' -> ');
  return `depth=${ctx.depth} chain=[${chain}] target=${ctx.targetReply.username}:${ctx.targetReply.id.slice(0, 8)}`;
}
