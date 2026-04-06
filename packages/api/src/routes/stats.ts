/**
 * Stats Routes - Gamified Achievements
 *
 * Time saved, haters handled, streaks, and achievement tracking
 */

import express, { Request, Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { tenantKeys, tenantPattern, getRedisClient } from '@threadsponder/shared';

function getOrgId(req: Request): string {
  const auth = (req as unknown as AuthenticatedRequest).auth;
  return auth?.accountId || process.env.DEFAULT_ORG_ID || 'default';
}

const router: Router = express.Router();

// Constants for calculations
const AVG_MINUTES_PER_REPLY = 3; // Time saved per automated reply
const AVG_WORDS_PER_COMEBACK = 8; // Avg words in a manual comeback

interface DailyStats {
  date: string;
  hatersHandled: number;
  wordsSaved: number;
  hostileWordsDeflected: number;
}

interface AchievementStats {
  // Today's stats
  today: {
    hatersHandled: number;
    minutesSaved: number;
    wordsSaved: number;
    hostileWordsDeflected: number;
  };
  // All-time stats
  allTime: {
    hatersHandled: number;
    minutesSaved: number;
    wordsSaved: number;
    hostileWordsDeflected: number;
  };
  // Streak tracking
  streak: {
    current: number;
    best: number;
    lastActiveDate: string | null;
  };
  // Recent daily breakdown
  recentDays: DailyStats[];
}

/**
 * GET /api/stats/achievements
 * Get gamified achievement stats
 */
router.get('/achievements', async (req, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const redis = await getRedisClient();

    // Get all reply map entries for counting (tenant-isolated)
    const replyMapKeys = await redis.keys(tenantPattern(orgId, 'reply', 'map', '*'));

    // Calculate stats from reply_map data
    let todayHatersHandled = 0;
    let todayHostileWords = 0;
    let allTimeHatersHandled = replyMapKeys.length;
    let allTimeHostileWords = 0;

    // Track daily stats for streak calculation
    const dailyActivity: Map<string, { count: number; hostileWords: number }> = new Map();

    for (const key of replyMapKeys) {
      const data = await redis.hgetall(key) as Record<string, string> | null;
      if (!data) continue; // Skip if key doesn't exist or has no data

      // Get the date from timestamp
      const timestamp: string = data.created_at || data.timestamp || '';
      const date = timestamp
        ? new Date(timestamp).toISOString().split('T')[0]
        : null;

      // Count hostile words
      const hostileText: string = data.hostile_text || '';
      const wordCount = hostileText.split(/\s+/).filter((w: string) => w.length > 0).length;
      allTimeHostileWords += wordCount;

      if (date) {
        // Track daily activity
        const existing = dailyActivity.get(date) || { count: 0, hostileWords: 0 };
        dailyActivity.set(date, {
          count: existing.count + 1,
          hostileWords: existing.hostileWords + wordCount
        });

        // Today's stats
        if (date === today) {
          todayHatersHandled++;
          todayHostileWords += wordCount;
        }
      }
    }

    // Calculate streak
    const sortedDates = Array.from(dailyActivity.keys()).sort().reverse();
    let currentStreak = 0;
    let checkDate = new Date(today);

    // Check if active today or yesterday to start streak
    const todayStr = today;
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    if (dailyActivity.has(todayStr) || dailyActivity.has(yesterdayStr)) {
      // Start counting streak
      for (let i = 0; i < 365; i++) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (dailyActivity.has(dateStr)) {
          currentStreak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        } else if (i > 0) {
          // Allow gap for today if not active yet
          break;
        } else {
          checkDate = new Date(checkDate.getTime() - 86400000);
        }
      }
    }

    // Get best streak from Redis (or calculate) - tenant-isolated
    const bestStreakResult = await redis.get(tenantKeys.stats.streakBest(orgId));
    const bestStreakStr: string = typeof bestStreakResult === 'string' ? bestStreakResult : '0';
    let bestStreak = parseInt(bestStreakStr);
    if (currentStreak > bestStreak) {
      bestStreak = currentStreak;
      await redis.set(tenantKeys.stats.streakBest(orgId), bestStreak.toString());
    }

    // Build recent days array (last 7 days)
    const recentDays: DailyStats[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const dayData = dailyActivity.get(date);
      recentDays.push({
        date,
        hatersHandled: dayData?.count || 0,
        wordsSaved: (dayData?.count || 0) * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: dayData?.hostileWords || 0
      });
    }

    const stats: AchievementStats = {
      today: {
        hatersHandled: todayHatersHandled,
        minutesSaved: todayHatersHandled * AVG_MINUTES_PER_REPLY,
        wordsSaved: todayHatersHandled * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: todayHostileWords
      },
      allTime: {
        hatersHandled: allTimeHatersHandled,
        minutesSaved: allTimeHatersHandled * AVG_MINUTES_PER_REPLY,
        wordsSaved: allTimeHatersHandled * AVG_WORDS_PER_COMEBACK,
        hostileWordsDeflected: allTimeHostileWords
      },
      streak: {
        current: currentStreak,
        best: bestStreak,
        lastActiveDate: sortedDates[0] || null
      },
      recentDays
    };

    res.json({ success: true, stats });
  } catch (error: any) {
    console.error('Achievement stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats/leaderboard
 * Weekly/monthly leaderboard (for SaaS multi-tenant)
 */
router.get('/leaderboard', async (req, res: Response) => {
  try {
    // Future: aggregate stats across accounts for leaderboard
    // For now, return placeholder
    res.json({
      success: true,
      leaderboard: [],
      message: 'Leaderboard coming soon'
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
