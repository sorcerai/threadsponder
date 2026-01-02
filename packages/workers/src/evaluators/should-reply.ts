/**
 * Should Reply Evaluator
 *
 * Determines whether the agent should reply to a given comment.
 * Multi-tenant Supabase version with:
 * - Blocklist management
 * - Reply deduplication (already replied check)
 * - User cooldowns (rate limiting per user)
 * - Classification confidence threshold
 *
 * Ported from eliza-threads with Supabase multi-tenant support
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/shared-logger.js';

// Configuration
const CONFIG = {
  MIN_CONFIDENCE: 0.6, // Below this, don't reply
  REPLY_COOLDOWN_MS: 30 * 60 * 1000, // 30 min cooldown per user
};

export interface ShouldReplyResult {
  shouldReply: boolean;
  reason: string;
  details?: {
    blocked?: boolean;
    alreadyReplied?: boolean;
    lowConfidence?: boolean;
    onCooldown?: boolean;
    classification?: string;
  };
}

export interface ShouldReplyInput {
  replyId: string;
  username: string;
  timestamp: string;
  classification: string;
  confidence: number;
}

/**
 * Should Reply Evaluator with Supabase multi-tenant support
 */
export class ShouldReplyEvaluator {
  private supabase: SupabaseClient;
  private accountId: string;

  constructor(supabaseUrl: string, supabaseKey: string, accountId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.accountId = accountId;
    logger.info(`ShouldReplyEvaluator initialized for account ${accountId}`);
  }

  /**
   * Check if user is blocked
   */
  private async isUserBlocked(username: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('blocked_users')
      .select('id')
      .eq('account_id', this.accountId)
      .eq('username', username.toLowerCase())
      .single();

    return !!data;
  }

  /**
   * Check if we already replied to this comment
   */
  private async hasAlreadyReplied(replyId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('replied_comments')
      .select('id')
      .eq('account_id', this.accountId)
      .eq('reply_id', replyId)
      .single();

    return !!data;
  }

  /**
   * Check if user is on cooldown
   */
  private async isOnCooldown(username: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('user_cooldowns')
      .select('last_reply_at')
      .eq('account_id', this.accountId)
      .eq('username', username.toLowerCase())
      .single();

    if (!data?.last_reply_at) return false;

    const lastReply = new Date(data.last_reply_at).getTime();
    const elapsed = Date.now() - lastReply;

    return elapsed < CONFIG.REPLY_COOLDOWN_MS;
  }

  /**
   * Main should reply check
   */
  async checkShouldReply(input: ShouldReplyInput): Promise<ShouldReplyResult> {
    // Check blocklist
    if (await this.isUserBlocked(input.username)) {
      logger.info(`Should reply: NO - @${input.username} is blocked`);
      return {
        shouldReply: false,
        reason: `User @${input.username} is blocked`,
        details: { blocked: true },
      };
    }

    // Check if already replied
    if (await this.hasAlreadyReplied(input.replyId)) {
      logger.info(`Should reply: NO - already replied to ${input.replyId}`);
      return {
        shouldReply: false,
        reason: 'Already replied to this comment',
        details: { alreadyReplied: true },
      };
    }

    // Check classification confidence
    if (input.confidence < CONFIG.MIN_CONFIDENCE) {
      logger.info(
        `Should reply: NO - low confidence ${(input.confidence * 100).toFixed(0)}%`
      );
      return {
        shouldReply: false,
        reason: `Low classification confidence: ${(input.confidence * 100).toFixed(0)}%`,
        details: { lowConfidence: true, classification: input.classification },
      };
    }

    // Check cooldown
    if (await this.isOnCooldown(input.username)) {
      logger.info(`Should reply: NO - @${input.username} on cooldown`);
      return {
        shouldReply: false,
        reason: `User @${input.username} is on cooldown`,
        details: { onCooldown: true },
      };
    }

    // Skip-classified comments
    if (input.classification === 'skip') {
      logger.info(`Should reply: NO - classified as skip`);
      return {
        shouldReply: false,
        reason: 'Classified as skip',
        details: { classification: 'skip' },
      };
    }

    logger.info(`Should reply: YES - @${input.username} (${input.classification})`);
    return {
      shouldReply: true,
      reason: 'All checks passed',
      details: { classification: input.classification },
    };
  }

  /**
   * Block a user
   */
  async blockUser(username: string, reason?: string): Promise<void> {
    const { error } = await this.supabase.from('blocked_users').upsert(
      {
        account_id: this.accountId,
        username: username.toLowerCase(),
        reason: reason || null,
        blocked_at: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,username',
      }
    );

    if (error) {
      logger.error(`Failed to block @${username}:`, error);
      return;
    }

    logger.info(`Blocked user: @${username}${reason ? ` (${reason})` : ''}`);
  }

  /**
   * Unblock a user
   */
  async unblockUser(username: string): Promise<void> {
    const { error } = await this.supabase
      .from('blocked_users')
      .delete()
      .eq('account_id', this.accountId)
      .eq('username', username.toLowerCase());

    if (error) {
      logger.error(`Failed to unblock @${username}:`, error);
      return;
    }

    logger.info(`Unblocked user: @${username}`);
  }

  /**
   * Get list of blocked users
   */
  async getBlockedUsers(): Promise<Array<{ username: string; reason: string | null; blocked_at: string }>> {
    const { data } = await this.supabase
      .from('blocked_users')
      .select('username, reason, blocked_at')
      .eq('account_id', this.accountId)
      .order('blocked_at', { ascending: false });

    return data || [];
  }

  /**
   * Mark a reply as handled (don't process again)
   */
  async markAsReplied(replyId: string): Promise<void> {
    const { error } = await this.supabase.from('replied_comments').upsert(
      {
        account_id: this.accountId,
        reply_id: replyId,
        replied_at: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,reply_id',
      }
    );

    if (error) {
      logger.error(`Failed to mark ${replyId} as replied:`, error);
      return;
    }

    logger.info(`Marked as replied: ${replyId}`);
  }

  /**
   * Set cooldown for a user
   */
  async setCooldown(username: string): Promise<void> {
    const { error } = await this.supabase.from('user_cooldowns').upsert(
      {
        account_id: this.accountId,
        username: username.toLowerCase(),
        last_reply_at: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,username',
      }
    );

    if (error) {
      logger.error(`Failed to set cooldown for @${username}:`, error);
      return;
    }

    logger.info(`Set cooldown for @${username}`);
  }

  /**
   * Clear cooldown for a user (for testing or manual override)
   */
  async clearCooldown(username: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_cooldowns')
      .delete()
      .eq('account_id', this.accountId)
      .eq('username', username.toLowerCase());

    if (error) {
      logger.error(`Failed to clear cooldown for @${username}:`, error);
      return;
    }

    logger.info(`Cleared cooldown for @${username}`);
  }

  /**
   * Get evaluator statistics
   */
  async getStats(): Promise<{
    blockedUsersCount: number;
    repliedCommentsCount: number;
    activeCooldownsCount: number;
  }> {
    const cooldownThreshold = new Date(Date.now() - CONFIG.REPLY_COOLDOWN_MS).toISOString();

    const [blockedResult, repliedResult, cooldownResult] = await Promise.all([
      this.supabase
        .from('blocked_users')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', this.accountId),
      this.supabase
        .from('replied_comments')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', this.accountId),
      this.supabase
        .from('user_cooldowns')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', this.accountId)
        .gte('last_reply_at', cooldownThreshold),
    ]);

    return {
      blockedUsersCount: blockedResult.count || 0,
      repliedCommentsCount: repliedResult.count || 0,
      activeCooldownsCount: cooldownResult.count || 0,
    };
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.supabase.from('blocked_users').delete().eq('account_id', this.accountId),
      this.supabase.from('replied_comments').delete().eq('account_id', this.accountId),
      this.supabase.from('user_cooldowns').delete().eq('account_id', this.accountId),
    ]);

    logger.info(`Cleared all should-reply data for account ${this.accountId}`);
  }
}

// Factory function for multi-tenant usage
export function createShouldReplyEvaluator(
  supabaseUrl: string,
  supabaseKey: string,
  accountId: string
): ShouldReplyEvaluator {
  return new ShouldReplyEvaluator(supabaseUrl, supabaseKey, accountId);
}

// Export config for external access
export const SHOULD_REPLY_CONFIG = CONFIG;
