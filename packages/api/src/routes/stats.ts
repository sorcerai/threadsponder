/**
 * Stats Routes - Gamified Achievements
 *
 * Time saved, haters handled, streaks, and achievement tracking (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

// Constants for calculations
const AVG_MINUTES_PER_REPLY = 3;
const AVG_WORDS_PER_COMEBACK = 8;

interface DailyStats {
  date: string;
  hatersHandled: number;
  wordsSaved: number;
  hostileWordsDeflected: number;
}

interface AchievementStats {
  today: {
    hatersHandled: number;
    minutesSaved: number;
    wordsSaved: number;
    hostileWordsDeflected: number;
  };
  allTime: {
    hatersHandled: number;
    minutesSaved: number;
    wordsSaved: number;
    hostileWordsDeflected: number;
  };
  streak: {
    current: number;
    best: number;
    lastActiveDate: string | null;
  };
  recentDays: DailyStats[];
}

/**
 * GET /api/stats/achievements
 * Get gamified achievement stats
 */
router.get('/achievements', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const today = new Date().toISOString().split('T')[0];
    const db = getDb();

    // All-time replied count
    const allTimeResult = db.prepare(
      'SELECT COUNT(*) as count FROM reply_history WHERE account_id = ? AND replied = 1'
    ).get(accountId) as { count: number };

    // Today's count
    const todayResult = db.prepare(
      "SELECT COUNT(*) as count FROM reply_history WHERE account_id = ? AND replied = 1 AND date(created_at) = ?"
    ).get(accountId, today) as { count: number };

    // All-time hostile words from hostile_words column
    const hostileWordsAllTime = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN hostile_words IS NOT NULL AND hostile_words != '' THEN LENGTH(hostile_words) - LENGTH(REPLACE(hostile_words, ' ', '')) + 1 ELSE 0 END), 0) as total FROM reply_history WHERE account_id = ? AND replied = 1"
    ).get(accountId) as { total: number };

    // Today's hostile words
    const hostileWordsTodayResult = db.prepare(
      "SELECT COALESCE(SUM(CASE WHEN hostile_words IS NOT NULL AND hostile_words != '' THEN LENGTH(hostile_words) - LENGTH(REPLACE(hostile_words, ' ', '')) + 1 ELSE 0 END), 0) as total FROM reply_history WHERE account_id = ? AND replied = 1 AND date(created_at) = ?"
    ).get(accountId, today) as { total: number };

    // Last 7 days by day
    const recentRows = db.prepare(
      "SELECT date(created_at) as date, COUNT(*) as count FROM reply_history WHERE account_id = ? AND replied = 1 AND created_at >= date('now', '-7 days') GROUP BY date(created_at)"
    ).all(accountId) as Array<{ date: string; count: number }>;

    // Build daily activity map for streak calculation
    const dailyActivity = new Map<string, number>();
    for (const row of recentRows) {
      dailyActivity.set(row.date, row.count);
    }

    // Also get all dates with activity for streak (need more than 7 days)
    const allActivityRows = db.prepare(
      "SELECT DISTINCT date(created_at) as date FROM reply_history WHERE account_id = ? AND replied = 1 ORDER BY date DESC"
    ).all(accountId) as Array<{ date: string }>;

    const allActivityDates = new Set(allActivityRows.map(r => r.date));

    // Calculate streak
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    let currentStreak = 0;

    if (allActivityDates.has(today) || allActivityDates.has(yesterdayStr)) {
      let checkDate = new Date(today);
      for (let i = 0; i < 365; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (allActivityDates.has(dateStr)) {
          currentStreak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        } else if (i > 0) {
          break;
        } else {
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
      }
    }

    // Build recent days array (last 7 days)
    const recentDays: DailyStats[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const dayCount = dailyActivity.get(date) || 0;
      recentDays.push({
        date,
        hatersHandled: dayCount,
        wordsSaved: dayCount * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: 0, // Would need per-day hostile_words aggregation
      });
    }

    const lastActiveDate = allActivityRows[0]?.date || null;
    const bestStreak = currentStreak; // No persistent best streak store; use current

    const stats: AchievementStats = {
      today: {
        hatersHandled: todayResult.count,
        minutesSaved: todayResult.count * AVG_MINUTES_PER_REPLY,
        wordsSaved: todayResult.count * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: hostileWordsTodayResult.total,
      },
      allTime: {
        hatersHandled: allTimeResult.count,
        minutesSaved: allTimeResult.count * AVG_MINUTES_PER_REPLY,
        wordsSaved: allTimeResult.count * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: hostileWordsAllTime.total,
      },
      streak: {
        current: currentStreak,
        best: bestStreak,
        lastActiveDate,
      },
      recentDays,
    };

    res.json({ success: true, stats });
  } catch (error: unknown) {
    console.error('Achievement stats error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/stats/leaderboard
 * Weekly/monthly leaderboard (placeholder)
 */
router.get('/leaderboard', (_req, res: Response) => {
  res.json({
    success: true,
    leaderboard: [],
    message: 'Leaderboard coming soon',
  });
});

export default router;
