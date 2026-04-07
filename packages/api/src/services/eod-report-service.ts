/**
 * EOD Report Service (SQLite backend)
 *
 * Generates end-of-day reports from SQLite data.
 * Supabase dependency removed — all queries use better-sqlite3.
 */

import { getDb } from '@threadsponder/shared';

export interface EODReport {
  date: string;
  generatedAt: number;
  summary: {
    totalReplies: number;
    triggered: number;
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

/**
 * Generate EOD report for an account using SQLite
 */
export function generateDailyReport(
  accountId: string,
  targetDate: Date = new Date(),
): EODReport {
  const db = getDb();
  const dateStr = targetDate.toISOString().split('T')[0];

  const rows = db.prepare(
    "SELECT classification, replied FROM reply_history WHERE account_id = ? AND date(created_at) = ?"
  ).all(accountId, dateStr) as Array<{ classification: string; replied: number }>;

  const classifications = { hostile: 0, friendly: 0, neutral: 0, meta: 0, skip: 0 };
  let triggered = 0;

  for (const r of rows) {
    if (r.replied) triggered++;
    const cls = r.classification as keyof typeof classifications;
    if (cls in classifications) classifications[cls]++;
  }

  // Weekly trend
  const weeklyTrend: Array<{ date: string; count: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().split('T')[0];
    const result = db.prepare(
      "SELECT COUNT(*) as count FROM reply_history WHERE account_id = ? AND date(created_at) = ?"
    ).get(accountId, dStr) as { count: number };
    weeklyTrend.push({ date: dStr, count: result.count });
  }

  return {
    date: dateStr,
    generatedAt: Date.now(),
    summary: {
      totalReplies: rows.length,
      triggered,
      classifications,
      avgEffortRatio: 0,
      engagement: { rate: 0, totalLikes: 0, avgLikes: 0, totalReplies: 0 },
    },
    patterns: [],
    bestHours: [],
    weeklyTrend,
    narrative: rows.length === 0 ? 'No replies today.' : `Handled ${rows.length} replies today.`,
  };
}
