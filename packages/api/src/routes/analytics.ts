/**
 * Analytics Routes
 *
 * Reply history and dashboard metrics (SQLite backend)
 */

import express, { Response, Router } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

/**
 * GET /api/analytics/overview
 * Dashboard overview metrics
 */
router.get('/overview', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const repliesResult = db.prepare(
      'SELECT COUNT(*) as count FROM reply_history WHERE account_id = ?'
    ).get(accountId) as { count: number };

    const postsResult = db.prepare(
      'SELECT COUNT(*) as count FROM focused_posts WHERE account_id = ? AND is_active = 1'
    ).get(accountId) as { count: number };

    const friendsResult = db.prepare(
      'SELECT COUNT(*) as count FROM friends WHERE account_id = ?'
    ).get(accountId) as { count: number };

    const examplesResult = db.prepare(
      'SELECT COUNT(*) as count FROM voice_examples WHERE account_id = ?'
    ).get(accountId) as { count: number };

    // Get replies by classification (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentReplies = db.prepare(
      'SELECT classification, replied FROM reply_history WHERE account_id = ? AND created_at >= ?'
    ).all(accountId, thirtyDaysAgo.toISOString()) as Array<{ classification: string; replied: number }>;

    const breakdown = { friendly: 0, neutral: 0, hostile: 0, skip: 0 };
    let totalPosted = 0;
    let totalProcessed = 0;

    for (const reply of recentReplies) {
      totalProcessed++;
      if (reply.replied) totalPosted++;
      if (reply.classification && Object.prototype.hasOwnProperty.call(breakdown, reply.classification)) {
        breakdown[reply.classification as keyof typeof breakdown]++;
      }
    }

    res.json({
      overview: {
        totalReplies: repliesResult.count,
        activePosts: postsResult.count,
        friends: friendsResult.count,
        voiceExamples: examplesResult.count,
      },
      last30Days: {
        processed: totalProcessed,
        posted: totalPosted,
        responseRate: totalProcessed > 0 ? ((totalPosted / totalProcessed) * 100).toFixed(1) : 0,
        breakdown,
      },
    });
  } catch (error) {
    console.error('[Analytics] Failed to get overview:', error);
    res.status(500).json({ error: 'Failed to get overview' });
  }
});

/**
 * GET /api/analytics/replies
 * Reply history with pagination
 */
router.get('/replies', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const classification = req.query.classification as string | undefined;
    const wasPosted = req.query.wasPosted as string | undefined;

    const db = getDb();

    const whereClauses = ['account_id = ?'];
    const params: unknown[] = [accountId];

    if (classification) {
      whereClauses.push('classification = ?');
      params.push(classification);
    }
    if (wasPosted === 'true') {
      whereClauses.push('replied = 1');
    } else if (wasPosted === 'false') {
      whereClauses.push('replied = 0');
    }

    const whereStr = whereClauses.join(' AND ');

    const countResult = db.prepare(
      `SELECT COUNT(*) as count FROM reply_history WHERE ${whereStr}`
    ).get(...params) as { count: number };

    const rows = db.prepare(
      `SELECT id, threads_reply_id, replier_username, reply_text, classification, confidence,
              our_response, replied, created_at
       FROM reply_history WHERE ${whereStr}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      replies: rows,
      pagination: {
        page,
        limit,
        total: countResult.count,
        totalPages: Math.ceil(countResult.count / limit),
      },
    });
  } catch (error) {
    console.error('[Analytics] Failed to get replies:', error);
    res.status(500).json({ error: 'Failed to get replies' });
  }
});

/**
 * GET /api/analytics/daily
 * Daily activity for chart
 */
router.get('/daily', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const days = Math.min(parseInt(req.query.days as string) || 14, 90);
    const db = getDb();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = db.prepare(
      `SELECT classification, replied, created_at
       FROM reply_history WHERE account_id = ? AND created_at >= ? ORDER BY created_at ASC`
    ).all(accountId, startDate.toISOString()) as Array<{
      classification: string;
      replied: number;
      created_at: string;
    }>;

    const dailyStats: Record<string, { processed: number; posted: number; friendly: number; neutral: number; hostile: number }> = {};

    for (const reply of rows) {
      const date = reply.created_at.split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { processed: 0, posted: 0, friendly: 0, neutral: 0, hostile: 0 };
      }
      dailyStats[date].processed++;
      if (reply.replied) dailyStats[date].posted++;
      if (reply.classification === 'friendly') dailyStats[date].friendly++;
      if (reply.classification === 'neutral') dailyStats[date].neutral++;
      if (reply.classification === 'hostile') dailyStats[date].hostile++;
    }

    const result: Array<{ date: string; processed: number; posted: number; friendly: number; neutral: number; hostile: number }> = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        ...(dailyStats[dateStr] || { processed: 0, posted: 0, friendly: 0, neutral: 0, hostile: 0 }),
      });
    }

    res.json({ daily: result });
  } catch (error) {
    console.error('[Analytics] Failed to get daily stats:', error);
    res.status(500).json({ error: 'Failed to get daily stats' });
  }
});

/**
 * GET /api/analytics/performance
 * Performance metrics — stubbed (processing_time_ms / model_used not in SQLite schema)
 */
router.get('/performance', (_req, res: Response) => {
  res.json({
    performance: {
      avgProcessingTime: 0,
      p50ProcessingTime: 0,
      p95ProcessingTime: 0,
      totalMeasured: 0,
      modelUsage: {},
    },
  });
});

/**
 * GET /api/analytics/ghost
 * Ghost Analytics — stubbed (post_performance / account_velocity_baseline tables don't exist)
 */
router.get('/ghost', (_req, res: Response) => {
  res.json({
    success: true,
    ghost: {
      baseline: {
        avgVelocity1h: '0',
        avgVelocity6h: '0',
        avgVelocity24h: '0',
        avgEngagementRate: '0',
        sampleCount: 0,
        hasEnoughData: false,
      },
      topPosts: [],
      hourlyTrend: [],
      evergreenCandidates: [],
      hasData: false,
    },
  });
});

export default router;
