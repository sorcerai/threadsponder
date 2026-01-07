/**
 * Bot Loop Detector Evaluator
 *
 * 3-layer bot loop detection to prevent infinite reply chains:
 *
 * Layer 1: Fast heuristics (pattern matching)
 *   - Known bot phrases
 *   - Repetitive patterns
 *   - Suspicious timing
 *
 * Layer 2: State tracking (Supabase)
 *   - Rate limits per user/thread
 *   - Conversation depth limits
 *   - Recent interaction history
 *
 * Layer 3: Semantic similarity
 *   - Compare incoming text to our previous outputs
 *   - Detect paraphrased responses
 *
 * Ported from eliza-threads with Supabase multi-tenant support
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/shared-logger.js';

// Configuration
const CONFIG = {
  // Layer 1: Heuristics
  MIN_REPLY_INTERVAL_MS: 10 * 1000, // 10 seconds (too fast = bot)

  // Layer 2: Rate limiting
  MAX_REPLIES_PER_USER_PER_HOUR: 5,
  MAX_REPLIES_PER_THREAD_PER_HOUR: 10,
  MAX_CONVERSATION_DEPTH: 15,

  // Layer 3: Semantic similarity
  SIMILARITY_THRESHOLD: 0.85, // Above this = too similar to our output
};

export interface BotLoopResult {
  isBotLoop: boolean;
  layer: 1 | 2 | 3 | 0; // 0 = not a bot loop
  reason: string;
  details?: {
    patternMatched?: string;
    rateExceeded?: boolean;
    depthExceeded?: boolean;
    similarityScore?: number;
  };
}

export interface BotLoopInput {
  incomingText: string;
  username: string;
  threadId: string;
  replyId: string;
  replyTimestamp: Date;
  ourLastReplyTimestamp?: Date;
  mediaType?: string;
  hasMedia?: boolean;
}

// Known bot/spam patterns (Layer 1)
const BOT_PATTERNS = [
  // Generic bot phrases
  /^(hi|hello|hey)!?\s*$/i,
  /^thanks?\s*(for\s+(sharing|this))?\s*!?\s*$/i,
  /^great\s*(post|content|share)!?\s*$/i,
  /^nice\s*(one|post)!?\s*$/i,
  /^interesting!?\s*$/i,
  /^wow!?\s*$/i,
  /^amazing!?\s*$/i,
  /^love\s*(this|it)!?\s*$/i,
  /^follow\s*(me|back)/i,
  /^check\s*(out\s+)?my\s*(profile|bio|link)/i,

  // Spam patterns
  /\b(dm|message)\s*me\b/i,
  /\bfollow\s*(4|for)\s*follow\b/i,
  /\bf4f\b/i,
  /\bl4l\b/i,
  /\blink\s*in\s*bio\b/i,

  // Repetitive characters
  /(.)\1{4,}/, // 5+ of same char (hahahaha, etc.)

  // Bot account indicators in username
  /bot[0-9]+/i,
  /_bot$/i,
  /^bot_/i,
];

// Phrases that indicate they're copying us or another bot
const COPY_PATTERNS = [
  /^(same|exactly|this|facts?|real|true|truth)!?\s*$/i,
  /^agreed!?\s*$/i,
  /^100%?\s*$/i,
  /^fr\s*(fr)?\s*$/i, // "fr fr"
  /^no\s*cap\s*$/i,
  /^word\s*$/i,
  /^say\s*less\s*$/i,
];

/**
 * Layer 1: Fast heuristic checks (no database)
 */
function checkLayer1Heuristics(input: BotLoopInput): BotLoopResult | null {
  const text = input.incomingText.trim();

  // Check bot patterns
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(text) || pattern.test(input.username)) {
      return {
        isBotLoop: true,
        layer: 1,
        reason: 'Matches known bot/spam pattern',
        details: { patternMatched: pattern.toString() },
      };
    }
  }

  // Check for suspiciously fast replies
  if (input.ourLastReplyTimestamp) {
    const timeSinceOurReply =
      input.replyTimestamp.getTime() - input.ourLastReplyTimestamp.getTime();
    if (timeSinceOurReply < CONFIG.MIN_REPLY_INTERVAL_MS) {
      return {
        isBotLoop: true,
        layer: 1,
        reason: `Reply too fast: ${timeSinceOurReply}ms (min: ${CONFIG.MIN_REPLY_INTERVAL_MS}ms)`,
        details: { patternMatched: 'timing' },
      };
    }
  }

  // Check for copy-style responses (might be mirroring us)
  for (const pattern of COPY_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isBotLoop: true,
        layer: 1,
        reason: 'Appears to be copying/echoing responses',
        details: { patternMatched: pattern.toString() },
      };
    }
  }

  // Check for extremely short content with no substance
  if (text.length < 3 && !input.hasMedia) {
    return {
      isBotLoop: true,
      layer: 1,
      reason: 'Content too short to be meaningful',
      details: { patternMatched: 'length' },
    };
  }

  return null; // Passed Layer 1
}

/**
 * Bot Loop Detector with Supabase multi-tenant support
 */
export class BotLoopDetector {
  private supabase: SupabaseClient;
  private accountId: string;

  constructor(supabaseUrl: string, supabaseKey: string, accountId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.accountId = accountId;
    logger.info(`BotLoopDetector initialized for account ${accountId}`);
  }

  /**
   * Layer 2: Supabase state-based checks
   */
  private async checkLayer2State(input: BotLoopInput): Promise<BotLoopResult | null> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Rate limit: replies per user per hour
    const { count: userReplies } = await this.supabase
      .from('bot_loop_rates')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', this.accountId)
      .eq('tracking_type', 'user')
      .eq('tracking_key', input.username.toLowerCase())
      .gte('created_at', hourAgo.toISOString());

    if ((userReplies || 0) >= CONFIG.MAX_REPLIES_PER_USER_PER_HOUR) {
      return {
        isBotLoop: true,
        layer: 2,
        reason: `Rate limit exceeded: ${userReplies} replies from @${input.username} in last hour`,
        details: { rateExceeded: true },
      };
    }

    // Rate limit: replies per thread per hour
    const { count: threadReplies } = await this.supabase
      .from('bot_loop_rates')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', this.accountId)
      .eq('tracking_type', 'thread')
      .eq('tracking_key', input.threadId)
      .gte('created_at', hourAgo.toISOString());

    if ((threadReplies || 0) >= CONFIG.MAX_REPLIES_PER_THREAD_PER_HOUR) {
      return {
        isBotLoop: true,
        layer: 2,
        reason: `Thread rate limit exceeded: ${threadReplies} in thread`,
        details: { rateExceeded: true },
      };
    }

    // Conversation depth check
    const { data: depthData } = await this.supabase
      .from('bot_loop_depths')
      .select('depth')
      .eq('account_id', this.accountId)
      .eq('thread_id', input.threadId)
      .eq('username', input.username.toLowerCase())
      .single();

    const currentDepth = depthData?.depth || 0;

    if (currentDepth >= CONFIG.MAX_CONVERSATION_DEPTH) {
      return {
        isBotLoop: true,
        layer: 2,
        reason: `Max conversation depth reached: ${currentDepth} exchanges`,
        details: { depthExceeded: true },
      };
    }

    return null; // Passed Layer 2
  }

  /**
   * Layer 3: Semantic similarity check
   * Compares incoming text to our recent outputs to detect bot loops
   */
  private async checkLayer3Semantic(input: BotLoopInput): Promise<BotLoopResult | null> {
    // Get our recent outputs for this thread
    const { data: recentOutputs } = await this.supabase
      .from('bot_loop_outputs')
      .select('output_text')
      .eq('account_id', this.accountId)
      .eq('thread_id', input.threadId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!recentOutputs || recentOutputs.length === 0) {
      return null; // No outputs to compare
    }

    // Simple similarity check (word overlap)
    // For production, use embeddings for better accuracy
    const incomingWords = new Set(
      input.incomingText
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 2)
    );

    for (const output of recentOutputs) {
      const outputWords = new Set(
        output.output_text
          .toLowerCase()
          .split(/\s+/)
          .filter((w: string) => w.length > 2)
      );

      // Calculate Jaccard similarity
      const intersection = new Set([...incomingWords].filter((w: string) => outputWords.has(w)));
      const union = new Set([...incomingWords, ...outputWords]);

      const similarity = intersection.size / Math.max(union.size, 1);

      if (similarity >= CONFIG.SIMILARITY_THRESHOLD) {
        return {
          isBotLoop: true,
          layer: 3,
          reason: `Too similar to our output: ${(similarity * 100).toFixed(0)}% overlap`,
          details: { similarityScore: similarity },
        };
      }
    }

    return null; // Passed Layer 3
  }

  /**
   * Update rate tracking after processing
   */
  async updateRateTracking(input: BotLoopInput): Promise<void> {
    // Track user rate
    await this.supabase.from('bot_loop_rates').upsert(
      {
        account_id: this.accountId,
        tracking_type: 'user',
        tracking_key: input.username.toLowerCase(),
        reply_id: input.replyId,
      },
      {
        onConflict: 'account_id,tracking_type,tracking_key,reply_id',
      }
    );

    // Track thread rate
    await this.supabase.from('bot_loop_rates').upsert(
      {
        account_id: this.accountId,
        tracking_type: 'thread',
        tracking_key: input.threadId,
        reply_id: input.replyId,
      },
      {
        onConflict: 'account_id,tracking_type,tracking_key,reply_id',
      }
    );

    // Increment conversation depth
    await this.supabase.from('bot_loop_depths').upsert(
      {
        account_id: this.accountId,
        thread_id: input.threadId,
        username: input.username.toLowerCase(),
        depth: 1,
        last_updated: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,thread_id,username',
      }
    );

    // If already exists, increment depth
    const { data: existing } = await this.supabase
      .from('bot_loop_depths')
      .select('depth')
      .eq('account_id', this.accountId)
      .eq('thread_id', input.threadId)
      .eq('username', input.username.toLowerCase())
      .single();

    if (existing) {
      await this.supabase
        .from('bot_loop_depths')
        .update({
          depth: existing.depth + 1,
          last_updated: new Date().toISOString(),
        })
        .eq('account_id', this.accountId)
        .eq('thread_id', input.threadId)
        .eq('username', input.username.toLowerCase());
    }
  }

  /**
   * Track our output for future similarity checks
   */
  async trackOurOutput(threadId: string, text: string): Promise<void> {
    await this.supabase.from('bot_loop_outputs').insert({
      account_id: this.accountId,
      thread_id: threadId,
      output_text: text,
    });

    // Keep only last 20 outputs per thread
    const { data: outputs } = await this.supabase
      .from('bot_loop_outputs')
      .select('id')
      .eq('account_id', this.accountId)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false });

    if (outputs && outputs.length > 20) {
      const idsToDelete = outputs.slice(20).map((o) => o.id);
      await this.supabase.from('bot_loop_outputs').delete().in('id', idsToDelete);
    }
  }

  /**
   * Main bot loop check function
   */
  async checkBotLoop(input: BotLoopInput): Promise<BotLoopResult> {
    // Layer 1: Fast heuristics (no DB)
    const layer1Result = checkLayer1Heuristics(input);
    if (layer1Result) {
      logger.info(`Bot loop [L1]: ${layer1Result.reason} from @${input.username}`);
      return layer1Result;
    }

    // Layer 2: State tracking
    const layer2Result = await this.checkLayer2State(input);
    if (layer2Result) {
      logger.info(`Bot loop [L2]: ${layer2Result.reason} from @${input.username}`);
      return layer2Result;
    }

    // Layer 3: Semantic similarity
    const layer3Result = await this.checkLayer3Semantic(input);
    if (layer3Result) {
      logger.info(`Bot loop [L3]: ${layer3Result.reason} from @${input.username}`);
      return layer3Result;
    }

    // Update tracking for future checks
    await this.updateRateTracking(input);

    return {
      isBotLoop: false,
      layer: 0,
      reason: 'Passed all bot loop checks',
    };
  }

  /**
   * Get bot loop statistics
   */
  async getStats(): Promise<{
    totalRateEntries: number;
    activeDepths: number;
    trackedOutputs: number;
  }> {
    const { count: rateCount } = await this.supabase
      .from('bot_loop_rates')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', this.accountId);

    const { count: depthCount } = await this.supabase
      .from('bot_loop_depths')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', this.accountId);

    const { count: outputCount } = await this.supabase
      .from('bot_loop_outputs')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', this.accountId);

    return {
      totalRateEntries: rateCount || 0,
      activeDepths: depthCount || 0,
      trackedOutputs: outputCount || 0,
    };
  }

  /**
   * Clear all tracking data (for testing)
   */
  async clearAll(): Promise<void> {
    await this.supabase.from('bot_loop_rates').delete().eq('account_id', this.accountId);
    await this.supabase.from('bot_loop_depths').delete().eq('account_id', this.accountId);
    await this.supabase.from('bot_loop_outputs').delete().eq('account_id', this.accountId);
    logger.info(`Cleared all bot loop tracking for account ${this.accountId}`);
  }
}

// Factory function for multi-tenant usage
export function createBotLoopDetector(
  supabaseUrl: string,
  supabaseKey: string,
  accountId: string
): BotLoopDetector {
  return new BotLoopDetector(supabaseUrl, supabaseKey, accountId);
}
