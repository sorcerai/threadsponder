/**
 * Evaluators Orchestrator
 *
 * Unified interface for all evaluators:
 * - BotLoopDetector: 3-layer bot loop prevention
 * - ShouldReplyEvaluator: Reply decision logic
 * - EngagementTracker: Reply effectiveness metrics
 *
 * Multi-tenant Supabase version with factory pattern
 */

// Re-export individual evaluators
export {
  BotLoopDetector,
  createBotLoopDetector,
  type BotLoopResult,
  type BotLoopInput,
} from './bot-loop.js';

export {
  ShouldReplyEvaluator,
  createShouldReplyEvaluator,
  SHOULD_REPLY_CONFIG,
  type ShouldReplyResult,
  type ShouldReplyInput,
} from './should-reply.js';

export {
  EngagementTracker,
  createEngagementTracker,
  type EngagementResult,
  type EngagementMetrics,
  type EngagementStats,
  type TrackingInput,
} from './engagement-tracker.js';

// Import for orchestrator
import { BotLoopDetector, createBotLoopDetector, type BotLoopInput, type BotLoopResult } from './bot-loop.js';
import {
  ShouldReplyEvaluator,
  createShouldReplyEvaluator,
  type ShouldReplyInput,
  type ShouldReplyResult,
} from './should-reply.js';
import {
  EngagementTracker,
  createEngagementTracker,
  type TrackingInput,
  type EngagementResult,
} from './engagement-tracker.js';
import { logger } from '../utils/shared-logger.js';

/**
 * Combined evaluation input
 */
export interface EvaluationInput {
  replyId: string;
  username: string;
  threadId: string;
  text: string;
  timestamp: Date;
  classification: string;
  confidence: number;
  hasMedia?: boolean;
  mediaType?: string;
  ourLastReplyTimestamp?: Date;
}

/**
 * Combined evaluation result
 */
export interface EvaluationResult {
  // Core decision
  shouldReply: boolean;
  reason: string;

  // Individual results
  botLoopResult: BotLoopResult;
  shouldReplyResult: ShouldReplyResult;

  // Metadata
  evaluatedAt: Date;
  evaluationTimeMs: number;
}

/**
 * Post-reply tracking input
 */
export interface PostReplyTrackingInput {
  ourReplyId: string;
  ourReplyText: string;
  hostileId: string;
  hostileText: string;
  hostileUser: string;
  threadId: string;
  classification: string;
  patternUsed?: string;
}

/**
 * Unified Evaluators Orchestrator
 *
 * Combines all evaluators into a single interface for:
 * - Pre-reply evaluation (should we reply?)
 * - Post-reply tracking (how did we do?)
 */
export class EvaluatorsOrchestrator {
  private botLoopDetector: BotLoopDetector;
  private shouldReplyEvaluator: ShouldReplyEvaluator;
  private engagementTracker: EngagementTracker;
  private accountId: string;

  constructor(supabaseUrl: string, supabaseKey: string, accountId: string) {
    this.accountId = accountId;
    this.botLoopDetector = createBotLoopDetector(supabaseUrl, supabaseKey, accountId);
    this.shouldReplyEvaluator = createShouldReplyEvaluator(supabaseUrl, supabaseKey, accountId);
    this.engagementTracker = createEngagementTracker(supabaseUrl, supabaseKey, accountId);

    logger.info(`EvaluatorsOrchestrator initialized for account ${accountId}`);
  }

  /**
   * Pre-reply evaluation: Should we reply to this comment?
   *
   * Runs all checks in optimal order:
   * 1. Bot loop detection (fast heuristics first)
   * 2. Should reply checks (blocklist, cooldowns, etc.)
   */
  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const startTime = Date.now();

    // 1. Bot loop detection (fastest checks first)
    const botLoopInput: BotLoopInput = {
      incomingText: input.text,
      username: input.username,
      threadId: input.threadId,
      replyId: input.replyId,
      replyTimestamp: input.timestamp,
      ourLastReplyTimestamp: input.ourLastReplyTimestamp,
      hasMedia: input.hasMedia,
      mediaType: input.mediaType,
    };

    const botLoopResult = await this.botLoopDetector.checkBotLoop(botLoopInput);

    // Early exit if bot loop detected
    if (botLoopResult.isBotLoop) {
      return {
        shouldReply: false,
        reason: `Bot loop detected: ${botLoopResult.reason}`,
        botLoopResult,
        shouldReplyResult: {
          shouldReply: false,
          reason: 'Skipped - bot loop detected',
        },
        evaluatedAt: new Date(),
        evaluationTimeMs: Date.now() - startTime,
      };
    }

    // 2. Should reply checks
    const shouldReplyInput: ShouldReplyInput = {
      replyId: input.replyId,
      username: input.username,
      timestamp: input.timestamp.toISOString(),
      classification: input.classification,
      confidence: input.confidence,
    };

    const shouldReplyResult = await this.shouldReplyEvaluator.checkShouldReply(shouldReplyInput);

    return {
      shouldReply: shouldReplyResult.shouldReply,
      reason: shouldReplyResult.reason,
      botLoopResult,
      shouldReplyResult,
      evaluatedAt: new Date(),
      evaluationTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Post-reply tracking: Track our reply for learning
   *
   * Call this after successfully posting a reply to:
   * - Mark comment as replied (prevents double replies)
   * - Set user cooldown
   * - Track engagement metrics
   * - Track our output for bot loop detection
   */
  async trackReply(input: PostReplyTrackingInput): Promise<EngagementResult> {
    // 1. Mark as replied
    await this.shouldReplyEvaluator.markAsReplied(input.hostileId);

    // 2. Set cooldown for user
    await this.shouldReplyEvaluator.setCooldown(input.hostileUser);

    // 3. Track our output for bot loop detection
    await this.botLoopDetector.trackOurOutput(input.threadId, input.ourReplyText);

    // 4. Track engagement metrics
    const engagementInput: TrackingInput = {
      ourReplyId: input.ourReplyId,
      ourReplyText: input.ourReplyText,
      hostileId: input.hostileId,
      hostileText: input.hostileText,
      hostileUser: input.hostileUser,
      classification: input.classification,
      patternUsed: input.patternUsed,
    };

    const engagementResult = await this.engagementTracker.trackEngagement(engagementInput);

    logger.info(
      `Reply tracked: ${input.ourReplyId} → @${input.hostileUser} ` +
        `(${input.classification}, effort ${engagementResult.metrics.effortRatio.toFixed(1)}x)`
    );

    return engagementResult;
  }

  /**
   * Block a user
   */
  async blockUser(username: string, reason?: string): Promise<void> {
    await this.shouldReplyEvaluator.blockUser(username, reason);
  }

  /**
   * Unblock a user
   */
  async unblockUser(username: string): Promise<void> {
    await this.shouldReplyEvaluator.unblockUser(username);
  }

  /**
   * Get blocked users list
   */
  async getBlockedUsers(): Promise<Array<{ username: string; reason: string | null; blocked_at: string }>> {
    return this.shouldReplyEvaluator.getBlockedUsers();
  }

  /**
   * Get combined statistics
   */
  async getStats(): Promise<{
    shouldReply: {
      blockedUsersCount: number;
      repliedCommentsCount: number;
      activeCooldownsCount: number;
    };
    botLoop: {
      totalRateEntries: number;
      activeDepths: number;
      trackedOutputs: number;
    };
    engagement: {
      totalReplies: number;
      avgEffortRatio: number;
      topPerformingPatterns: string[];
    };
  }> {
    const [shouldReplyStats, botLoopStats, engagementStats] = await Promise.all([
      this.shouldReplyEvaluator.getStats(),
      this.botLoopDetector.getStats(),
      this.engagementTracker.getStats(),
    ]);

    return {
      shouldReply: shouldReplyStats,
      botLoop: botLoopStats,
      engagement: {
        totalReplies: engagementStats.totalReplies,
        avgEffortRatio: engagementStats.avgEffortRatio,
        topPerformingPatterns: engagementStats.topPerformingPatterns,
      },
    };
  }

  /**
   * Get engagement analytics
   */
  async getEngagementAnalytics(): Promise<{
    patternReport: Array<{ pattern: string; usageCount: number; avgEffortRatio: number }>;
    bestHours: number[];
    stats: import('./engagement-tracker.js').EngagementStats;
  }> {
    const [patternReport, bestHours, stats] = await Promise.all([
      this.engagementTracker.getPatternReport(),
      this.engagementTracker.getBestPostingHours(),
      this.engagementTracker.getStats(),
    ]);

    return { patternReport, bestHours, stats };
  }

  /**
   * Clear all data (for testing only)
   */
  async clearAllData(): Promise<void> {
    await Promise.all([
      this.shouldReplyEvaluator.clearAll(),
      this.botLoopDetector.clearAll(),
      this.engagementTracker.clearAll(),
    ]);

    logger.info(`Cleared all evaluator data for account ${this.accountId}`);
  }

  /**
   * Access individual evaluators if needed
   */
  get evaluators() {
    return {
      botLoop: this.botLoopDetector,
      shouldReply: this.shouldReplyEvaluator,
      engagement: this.engagementTracker,
    };
  }
}

/**
 * Factory function for creating the orchestrator
 */
export function createEvaluatorsOrchestrator(
  supabaseUrl: string,
  supabaseKey: string,
  accountId: string
): EvaluatorsOrchestrator {
  return new EvaluatorsOrchestrator(supabaseUrl, supabaseKey, accountId);
}
