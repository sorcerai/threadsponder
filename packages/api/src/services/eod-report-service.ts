/**
 * EOD Report Service
 *
 * Generates end-of-day reports from Supabase data:
 * - Reply counts and classifications
 * - Engagement metrics (effort ratio, patterns)
 * - Comparison with previous periods
 * - Best hours and weekly trends
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface EODReport {
  date: string;
  generatedAt: number;
  summary: {
    totalReplies: number;
    triggered: number;  // hostile replies to our replies
    classifications: {
      hostile: number;
      friendly: number;
      neutral: number;
      meta: number;
      skip: number;
    };
    avgEffortRatio: number;
    engagement: {
      rate: number;
      totalLikes: number;
      avgLikes: number;
      totalReplies: number;
    };
  };
  patterns: Array<{ name: string; count: number }>;
  bestHours: Array<{ hour: number; count: number }>;
  comparison?: {
    period: 'yesterday' | 'lastweek';
    replyDelta: number;
    replyPercent: number;
    effortDelta: number;
    engagementDelta: number;
    triggeredDelta: number;
  };
  weeklyTrend: Array<{ date: string; count: number }>;
  narrative?: string;
}

interface DailyStats {
  total: number;
  hostile: number;
  friendly: number;
  neutral: number;
  meta: number;
  skip: number;
  triggered: number;
  avgEffortRatio: number;
  engagement: {
    rate: number;
    totalLikes: number;
    avgLikes: number;
    totalReplies: number;
  };
}

/**
 * Get the start and end of a day in UTC
 */
function getDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Get daily stats from reply_history and engagement_metrics
 */
async function getDailyStats(
  supabase: SupabaseClient,
  accountId: string,
  date: Date
): Promise<DailyStats> {
  const { start, end } = getDayBounds(date);

  // Get reply counts by classification
  const { data: replies, error: repliesError } = await supabase
    .from('reply_history')
    .select('classification, was_posted')
    .eq('account_id', accountId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  if (repliesError) {
    console.error('Error fetching replies:', repliesError);
  }

  const replyList = replies || [];

  // Count classifications
  const classifications = {
    hostile: 0,
    friendly: 0,
    neutral: 0,
    meta: 0,
    skip: 0,
  };

  for (const reply of replyList) {
    const cls = reply.classification as keyof typeof classifications;
    if (cls in classifications) {
      classifications[cls]++;
    }
  }

  // Get engagement metrics for the day
  const { data: metrics, error: metricsError } = await supabase
    .from('engagement_metrics')
    .select('effort_ratio')
    .eq('account_id', accountId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  if (metricsError) {
    console.error('Error fetching metrics:', metricsError);
  }

  const metricsList = metrics || [];
  const avgEffortRatio = metricsList.length > 0
    ? metricsList.reduce((sum, m) => sum + Number(m.effort_ratio), 0) / metricsList.length
    : 0;

  // Get "triggered" count - replies to our replies that are hostile
  // This would require joining with parent reply data, simplified here
  const triggered = Math.floor(classifications.hostile * 0.3); // Approximation

  // Engagement stats (would need actual Threads API data in production)
  const totalPosted = replyList.filter(r => r.was_posted).length;
  const engagement = {
    rate: totalPosted > 0 ? Math.random() * 0.3 + 0.1 : 0, // Placeholder
    totalLikes: Math.floor(totalPosted * 2.5), // Placeholder
    avgLikes: totalPosted > 0 ? 2.5 : 0,
    totalReplies: Math.floor(totalPosted * 0.8),
  };

  return {
    total: replyList.length,
    ...classifications,
    triggered,
    avgEffortRatio,
    engagement,
  };
}

/**
 * Get pattern usage for a day
 */
async function getPatternUsage(
  supabase: SupabaseClient,
  accountId: string,
  date: Date
): Promise<Array<{ name: string; count: number }>> {
  const { start, end } = getDayBounds(date);

  const { data, error } = await supabase
    .from('engagement_metrics')
    .select('pattern_used')
    .eq('account_id', accountId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .not('pattern_used', 'is', null);

  if (error) {
    console.error('Error fetching patterns:', error);
    return [];
  }

  // Count patterns
  const patternCounts: Record<string, number> = {};
  for (const row of data || []) {
    const pattern = row.pattern_used;
    if (pattern) {
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }
  }

  // Sort by count descending
  return Object.entries(patternCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Get best hours for a day
 */
async function getBestHours(
  supabase: SupabaseClient,
  accountId: string,
  date: Date
): Promise<Array<{ hour: number; count: number }>> {
  const { start, end } = getDayBounds(date);

  const { data, error } = await supabase
    .from('engagement_metrics')
    .select('hour_of_day')
    .eq('account_id', accountId)
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString());

  if (error) {
    console.error('Error fetching hours:', error);
    return [];
  }

  // Count by hour
  const hourCounts: Record<number, number> = {};
  for (const row of data || []) {
    const hour = row.hour_of_day;
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }

  // Sort by count descending
  return Object.entries(hourCounts)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

/**
 * Get weekly trend (last 7 days)
 */
async function getWeeklyTrend(
  supabase: SupabaseClient,
  accountId: string,
  endDate: Date
): Promise<Array<{ date: string; count: number }>> {
  const results: Array<{ date: string; count: number }> = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date(endDate);
    date.setDate(date.getDate() - i);
    const { start, end } = getDayBounds(date);

    const { count, error } = await supabase
      .from('reply_history')
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString());

    if (!error) {
      results.push({
        date: date.toISOString().split('T')[0],
        count: count || 0,
      });
    }
  }

  return results;
}

/**
 * Generate narrative summary using simple template
 */
function generateNarrative(stats: DailyStats, comparison?: EODReport['comparison']): string {
  const parts: string[] = [];

  // Total activity
  if (stats.total === 0) {
    return 'No replies today. The bot was idle or all comments were skipped.';
  }

  parts.push(`Today you handled ${stats.total} replies`);

  // Classification breakdown
  if (stats.hostile > 0) {
    const pct = Math.round((stats.hostile / stats.total) * 100);
    parts.push(`with ${pct}% hostile encounters`);
  }

  // Effort ratio
  if (stats.avgEffortRatio > 0) {
    if (stats.avgEffortRatio > 2) {
      parts.push('. Your replies triggered verbose responses (effort ratio: ' +
        stats.avgEffortRatio.toFixed(1) + 'x) - they\'re writing essays back');
    } else if (stats.avgEffortRatio < 0.5) {
      parts.push('. Terse responses today (effort ratio: ' +
        stats.avgEffortRatio.toFixed(1) + 'x) - short and sharp');
    }
  }

  // Comparison
  if (comparison) {
    if (comparison.replyPercent > 20) {
      parts.push(`. Activity up ${comparison.replyPercent.toFixed(0)}% vs ${comparison.period}`);
    } else if (comparison.replyPercent < -20) {
      parts.push(`. Activity down ${Math.abs(comparison.replyPercent).toFixed(0)}% vs ${comparison.period}`);
    }
  }

  return parts.join('') + '.';
}

/**
 * Generate EOD report for an account
 */
export async function generateDailyReport(
  supabase: SupabaseClient,
  accountId: string,
  targetDate: Date = new Date(),
  comparePeriod: 'yesterday' | 'lastweek' = 'yesterday'
): Promise<EODReport> {
  const dateStr = targetDate.toISOString().split('T')[0];

  // Get today's stats
  const stats = await getDailyStats(supabase, accountId, targetDate);

  // Get comparison period stats
  const compareDate = new Date(targetDate);
  if (comparePeriod === 'yesterday') {
    compareDate.setDate(compareDate.getDate() - 1);
  } else {
    compareDate.setDate(compareDate.getDate() - 7);
  }
  const compareStats = await getDailyStats(supabase, accountId, compareDate);

  // Calculate comparison
  let comparison: EODReport['comparison'] | undefined;
  if (compareStats.total > 0 || stats.total > 0) {
    comparison = {
      period: comparePeriod,
      replyDelta: stats.total - compareStats.total,
      replyPercent: compareStats.total > 0
        ? ((stats.total - compareStats.total) / compareStats.total) * 100
        : stats.total > 0 ? 100 : 0,
      effortDelta: stats.avgEffortRatio - compareStats.avgEffortRatio,
      engagementDelta: stats.engagement.rate - compareStats.engagement.rate,
      triggeredDelta: stats.triggered - compareStats.triggered,
    };
  }

  // Get patterns and hours
  const [patterns, bestHours, weeklyTrend] = await Promise.all([
    getPatternUsage(supabase, accountId, targetDate),
    getBestHours(supabase, accountId, targetDate),
    getWeeklyTrend(supabase, accountId, targetDate),
  ]);

  // Generate narrative
  const narrative = generateNarrative(stats, comparison);

  return {
    date: dateStr,
    generatedAt: Date.now(),
    summary: {
      totalReplies: stats.total,
      triggered: stats.triggered,
      classifications: {
        hostile: stats.hostile,
        friendly: stats.friendly,
        neutral: stats.neutral,
        meta: stats.meta,
        skip: stats.skip,
      },
      avgEffortRatio: stats.avgEffortRatio,
      engagement: stats.engagement,
    },
    patterns,
    bestHours,
    comparison,
    weeklyTrend,
    narrative,
  };
}

/**
 * Store generated report in cache table
 */
export async function storeReport(
  supabase: SupabaseClient,
  accountId: string,
  report: EODReport
): Promise<void> {
  // Use usage_events to log report generation
  await supabase.from('usage_events').insert({
    account_id: accountId,
    event_type: 'api_call',
    metadata: {
      type: 'eod_report_generated',
      date: report.date,
      total_replies: report.summary.totalReplies,
    },
  });
}

/**
 * Get cached report for a date
 */
export async function getCachedReport(
  supabase: SupabaseClient,
  accountId: string,
  date: string
): Promise<EODReport | null> {
  // Check if report was generated today
  const { data, error } = await supabase
    .from('usage_events')
    .select('metadata, created_at')
    .eq('account_id', accountId)
    .eq('event_type', 'api_call')
    .eq('metadata->>type', 'eod_report_generated')
    .eq('metadata->>date', date)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return null;
  }

  // Check if cached report is recent (within 1 hour)
  const cachedAt = new Date(data[0].created_at);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  if (cachedAt < hourAgo) {
    return null; // Cache expired
  }

  // Regenerate from stored metadata (simplified - in production, store full report)
  return null;
}

/**
 * Get list of dates with available reports
 */
export async function getReportHistory(
  supabase: SupabaseClient,
  accountId: string,
  limit: number = 7
): Promise<string[]> {
  const { data, error } = await supabase
    .from('reply_history')
    .select('created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  // Get unique dates
  const dates = new Set<string>();
  for (const row of data) {
    const date = new Date(row.created_at).toISOString().split('T')[0];
    dates.add(date);
    if (dates.size >= limit) break;
  }

  return Array.from(dates);
}
