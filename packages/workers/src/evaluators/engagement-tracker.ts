/**
 * Engagement Tracker Evaluator
 *
 * Tracks reply effectiveness for learning:
 * - Effort ratio (their words vs our words)
 * - Pattern effectiveness
 * - Time of day patterns
 * - Classification distribution
 *
 * Multi-tenant Supabase version ported from eliza-threads
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/shared-logger.js';

export interface EngagementMetrics {
  effortRatio: number; // Their words / our words (higher = more asymmetry)
  ourWordCount: number;
  theirWordCount: number;
  classification: string;
  patternUsed?: string;
  timestamp: number;
  hour: number; // Hour of day (0-23) for time analysis
  dayOfWeek: number; // Day of week (0-6) for time analysis
}

export interface EngagementResult {
  tracked: boolean;
  replyId: string;
  metrics: EngagementMetrics;
  historicalAvg?: {
    avgEffortRatio: number;
    totalReplies: number;
  };
}

export interface TrackingInput {
  ourReplyId: string;
  ourReplyText: string;
  hostileId: string;
  hostileText: string;
  hostileUser: string;
  classification: string;
  patternUsed?: string;
}

export interface EngagementStats {
  totalReplies: number;
  avgEffortRatio: number;
  patternDistribution: Record<string, number>;
  classificationDistribution: Record<string, number>;
  hourlyDistribution: Record<string, number>;
  topPerformingPatterns: string[];
}

/**
 * Calculate effort ratio (their words / our words)
 * Higher ratio = better effort asymmetry
 */
function calculateEffortRatio(theirText: string, ourText: string): number {
  const theirWords = theirText.trim().split(/\s+/).length;
  const ourWords = ourText.trim().split(/\s+/).length;

  // Avoid division by zero
  if (ourWords === 0) return theirWords > 0 ? 999 : 1;

  return theirWords / ourWords;
}

/**
 * Detect which pattern was likely used
 */
function detectPatternUsed(ourText: string): string | undefined {
  const text = ourText.toLowerCase();

  // Pattern detection based on character.json patterns
  if (text.includes('thesis') || text.includes('essay') || text.includes('lesson plan')) {
    return 'effort_attack';
  }
  if (
    text.includes('keeping tabs') ||
    text.includes('memorized') ||
    text.includes('fan behavior')
  ) {
    return 'fan_behavior';
  }
  if (text.includes('sounds personal') || text.includes('fanfic') || text.includes('backstory')) {
    return 'projection';
  }
  if (text.includes('anyway') || text.includes('fascinating') || text.includes('detective')) {
    return 'dismissal';
  }
  if (text.length < 15) {
    return 'low_effort';
  }

  return undefined;
}

/**
 * Engagement Tracker with Supabase multi-tenant support
 */
export class EngagementTracker {
  private supabase: SupabaseClient;
  private accountId: string;

  constructor(supabaseUrl: string, supabaseKey: string, accountId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.accountId = accountId;
    logger.info(`EngagementTracker initialized for account ${accountId}`);
  }

  /**
   * Store engagement metrics and update aggregates
   */
  private async storeMetrics(replyId: string, metrics: EngagementMetrics): Promise<void> {
    // Store individual metrics
    const { error: metricsError } = await this.supabase.from('engagement_metrics').upsert(
      {
        account_id: this.accountId,
        reply_id: replyId,
        effort_ratio: metrics.effortRatio,
        our_word_count: metrics.ourWordCount,
        their_word_count: metrics.theirWordCount,
        classification: metrics.classification,
        pattern_used: metrics.patternUsed || null,
        hour_of_day: metrics.hour,
        day_of_week: metrics.dayOfWeek,
        created_at: new Date(metrics.timestamp).toISOString(),
      },
      {
        onConflict: 'account_id,reply_id',
      }
    );

    if (metricsError) {
      logger.error(`Failed to store metrics for ${replyId}:`, metricsError);
      return;
    }

    // Update pattern stats if pattern was used
    if (metrics.patternUsed) {
      await this.updatePatternStats(metrics.patternUsed, metrics.effortRatio);
    }

    // Update classification stats
    await this.updateClassificationStats(metrics.classification, metrics.effortRatio);

    // Update hourly stats
    await this.updateHourlyStats(metrics.hour, metrics.effortRatio);
  }

  /**
   * Update pattern usage statistics
   */
  private async updatePatternStats(pattern: string, effortRatio: number): Promise<void> {
    // Try to get existing stats
    const { data: existing } = await this.supabase
      .from('engagement_pattern_stats')
      .select('usage_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .eq('pattern_name', pattern)
      .single();

    if (existing) {
      // Update existing
      await this.supabase
        .from('engagement_pattern_stats')
        .update({
          usage_count: existing.usage_count + 1,
          total_effort_ratio: existing.total_effort_ratio + effortRatio,
          last_used: new Date().toISOString(),
        })
        .eq('account_id', this.accountId)
        .eq('pattern_name', pattern);
    } else {
      // Insert new
      await this.supabase.from('engagement_pattern_stats').insert({
        account_id: this.accountId,
        pattern_name: pattern,
        usage_count: 1,
        total_effort_ratio: effortRatio,
        last_used: new Date().toISOString(),
      });
    }
  }

  /**
   * Update classification statistics
   */
  private async updateClassificationStats(classification: string, effortRatio: number): Promise<void> {
    const { data: existing } = await this.supabase
      .from('engagement_classification_stats')
      .select('usage_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .eq('classification', classification)
      .single();

    if (existing) {
      await this.supabase
        .from('engagement_classification_stats')
        .update({
          usage_count: existing.usage_count + 1,
          total_effort_ratio: existing.total_effort_ratio + effortRatio,
          last_used: new Date().toISOString(),
        })
        .eq('account_id', this.accountId)
        .eq('classification', classification);
    } else {
      await this.supabase.from('engagement_classification_stats').insert({
        account_id: this.accountId,
        classification,
        usage_count: 1,
        total_effort_ratio: effortRatio,
        last_used: new Date().toISOString(),
      });
    }
  }

  /**
   * Update hourly statistics
   */
  private async updateHourlyStats(hour: number, effortRatio: number): Promise<void> {
    const { data: existing } = await this.supabase
      .from('engagement_hourly_stats')
      .select('reply_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .eq('hour_of_day', hour)
      .single();

    if (existing) {
      await this.supabase
        .from('engagement_hourly_stats')
        .update({
          reply_count: existing.reply_count + 1,
          total_effort_ratio: existing.total_effort_ratio + effortRatio,
        })
        .eq('account_id', this.accountId)
        .eq('hour_of_day', hour);
    } else {
      await this.supabase.from('engagement_hourly_stats').insert({
        account_id: this.accountId,
        hour_of_day: hour,
        reply_count: 1,
        total_effort_ratio: effortRatio,
      });
    }
  }

  /**
   * Get historical averages for comparison
   */
  private async getHistoricalAverages(): Promise<{
    avgEffortRatio: number;
    totalReplies: number;
  }> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('engagement_metrics')
      .select('effort_ratio')
      .eq('account_id', this.accountId)
      .gte('created_at', weekAgo);

    if (!data || data.length === 0) {
      return { avgEffortRatio: 0, totalReplies: 0 };
    }

    const totalRatio = data.reduce((sum, row) => sum + parseFloat(row.effort_ratio), 0);

    return {
      avgEffortRatio: totalRatio / data.length,
      totalReplies: data.length,
    };
  }

  /**
   * Track engagement metrics for a reply
   */
  async trackEngagement(input: TrackingInput): Promise<EngagementResult> {
    const now = new Date();
    const metrics: EngagementMetrics = {
      effortRatio: calculateEffortRatio(input.hostileText, input.ourReplyText),
      ourWordCount: input.ourReplyText.trim().split(/\s+/).length,
      theirWordCount: input.hostileText.trim().split(/\s+/).length,
      classification: input.classification,
      patternUsed: input.patternUsed || detectPatternUsed(input.ourReplyText),
      timestamp: now.getTime(),
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
    };

    // Store metrics
    await this.storeMetrics(input.ourReplyId, metrics);

    // Get historical context
    const historical = await this.getHistoricalAverages();

    logger.info(
      `Engagement tracked: ${input.ourReplyId} - ` +
        `effort ratio ${metrics.effortRatio.toFixed(1)}x ` +
        `(${metrics.theirWordCount}→${metrics.ourWordCount} words) ` +
        `pattern: ${metrics.patternUsed || 'none'}`
    );

    return {
      tracked: true,
      replyId: input.ourReplyId,
      metrics,
      historicalAvg: historical,
    };
  }

  /**
   * Get engagement statistics
   */
  async getStats(): Promise<EngagementStats> {
    const historical = await this.getHistoricalAverages();

    // Get pattern distribution
    const { data: patternData } = await this.supabase
      .from('engagement_pattern_stats')
      .select('pattern_name, usage_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .order('usage_count', { ascending: false });

    const patternDistribution: Record<string, number> = {};
    const patternEfficiency: Array<{ pattern: string; avgRatio: number; count: number }> = [];

    if (patternData) {
      for (const row of patternData) {
        patternDistribution[row.pattern_name] = row.usage_count;
        if (row.usage_count > 0) {
          patternEfficiency.push({
            pattern: row.pattern_name,
            avgRatio: row.total_effort_ratio / row.usage_count,
            count: row.usage_count,
          });
        }
      }
    }

    // Get classification distribution
    const { data: classData } = await this.supabase
      .from('engagement_classification_stats')
      .select('classification, usage_count')
      .eq('account_id', this.accountId);

    const classificationDistribution: Record<string, number> = {};
    if (classData) {
      for (const row of classData) {
        classificationDistribution[row.classification] = row.usage_count;
      }
    }

    // Get hourly distribution
    const { data: hourData } = await this.supabase
      .from('engagement_hourly_stats')
      .select('hour_of_day, reply_count')
      .eq('account_id', this.accountId);

    const hourlyDistribution: Record<string, number> = {};
    if (hourData) {
      for (const row of hourData) {
        hourlyDistribution[row.hour_of_day.toString()] = row.reply_count;
      }
    }

    // Get top performing patterns (by average effort ratio, min 5 uses)
    const topPerformingPatterns = patternEfficiency
      .filter((p) => p.count >= 5)
      .sort((a, b) => b.avgRatio - a.avgRatio)
      .slice(0, 5)
      .map((p) => p.pattern);

    return {
      totalReplies: historical.totalReplies,
      avgEffortRatio: historical.avgEffortRatio,
      patternDistribution,
      classificationDistribution,
      hourlyDistribution,
      topPerformingPatterns,
    };
  }

  /**
   * Get best hours to post based on engagement
   */
  async getBestPostingHours(): Promise<number[]> {
    const { data } = await this.supabase
      .from('engagement_hourly_stats')
      .select('hour_of_day, reply_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .order('reply_count', { ascending: false });

    if (!data || data.length === 0) {
      return [];
    }

    // Return top 3 hours by activity
    return data.slice(0, 3).map((row) => row.hour_of_day);
  }

  /**
   * Get pattern effectiveness report
   */
  async getPatternReport(): Promise<
    Array<{
      pattern: string;
      usageCount: number;
      avgEffortRatio: number;
    }>
  > {
    const { data } = await this.supabase
      .from('engagement_pattern_stats')
      .select('pattern_name, usage_count, total_effort_ratio')
      .eq('account_id', this.accountId)
      .order('usage_count', { ascending: false });

    if (!data) return [];

    return data.map((row) => ({
      pattern: row.pattern_name,
      usageCount: row.usage_count,
      avgEffortRatio: row.usage_count > 0 ? row.total_effort_ratio / row.usage_count : 0,
    }));
  }

  /**
   * Clear all data (for testing)
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.supabase.from('engagement_metrics').delete().eq('account_id', this.accountId),
      this.supabase.from('engagement_pattern_stats').delete().eq('account_id', this.accountId),
      this.supabase.from('engagement_classification_stats').delete().eq('account_id', this.accountId),
      this.supabase.from('engagement_hourly_stats').delete().eq('account_id', this.accountId),
    ]);

    logger.info(`Cleared all engagement data for account ${this.accountId}`);
  }
}

// Factory function for multi-tenant usage
export function createEngagementTracker(
  supabaseUrl: string,
  supabaseKey: string,
  accountId: string
): EngagementTracker {
  return new EngagementTracker(supabaseUrl, supabaseKey, accountId);
}
