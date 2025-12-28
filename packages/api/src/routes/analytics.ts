/**
 * Analytics Routes
 *
 * Reply history and dashboard metrics
 */

import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * GET /api/analytics/overview
 * Dashboard overview metrics
 */
router.get('/overview', async (req, res: Response) => {
  try {
    const { accountId } = (req as AuthenticatedRequest).auth;

    // Get counts in parallel
    const [repliesResult, postsResult, friendsResult, examplesResult] = await Promise.all([
      // Total replies processed
      getSupabase()
        .from('reply_history')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      // Total focused posts
      getSupabase()
        .from('focused_posts')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('is_active', true),
      // Total friends
      getSupabase()
        .from('friends')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      // Total voice examples
      getSupabase()
        .from('voice_examples')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('is_active', true),
    ]);

    // Get replies by classification (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentReplies } = await getSupabase()
      .from('reply_history')
      .select('classification, was_posted')
      .eq('account_id', accountId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Calculate breakdown
    const breakdown = {
      friendly: 0,
      neutral: 0,
      hostile: 0,
      skip: 0,
    };

    let totalPosted = 0;
    let totalProcessed = 0;

    for (const reply of recentReplies || []) {
      totalProcessed++;
      if (reply.was_posted) totalPosted++;
      if (reply.classification && breakdown.hasOwnProperty(reply.classification)) {
        breakdown[reply.classification as keyof typeof breakdown]++;
      }
    }

    res.json({
      overview: {
        totalReplies: repliesResult.count || 0,
        activePosts: postsResult.count || 0,
        friends: friendsResult.count || 0,
        voiceExamples: examplesResult.count || 0,
      },
      last30Days: {
        processed: totalProcessed,
        posted: totalPosted,
        responseRate: totalProcessed > 0 ? (totalPosted / totalProcessed * 100).toFixed(1) : 0,
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
router.get('/replies', async (req, res: Response) => {
  try {
    const { accountId } = (req as AuthenticatedRequest).auth;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const classification = req.query.classification as string | undefined;
    const wasPosted = req.query.wasPosted as string | undefined;

    let query = getSupabase()
      .from('reply_history')
      .select(`
        id, original_reply_id, original_username, original_text,
        classification, classification_confidence, our_response,
        was_posted, posted_at, skip_reason, processing_time_ms,
        model_used, created_at,
        threads_accounts (id, threads_username)
      `, { count: 'exact' })
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (classification) {
      query = query.eq('classification', classification);
    }
    if (wasPosted === 'true') {
      query = query.eq('was_posted', true);
    } else if (wasPosted === 'false') {
      query = query.eq('was_posted', false);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      replies: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
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
router.get('/daily', async (req, res: Response) => {
  try {
    const { accountId } = (req as AuthenticatedRequest).auth;
    const days = Math.min(parseInt(req.query.days as string) || 14, 90);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await getSupabase()
      .from('reply_history')
      .select('classification, was_posted, created_at')
      .eq('account_id', accountId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Group by day
    const dailyStats: Record<string, { processed: number; posted: number; friendly: number; neutral: number; hostile: number }> = {};

    for (const reply of data || []) {
      const date = reply.created_at.split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { processed: 0, posted: 0, friendly: 0, neutral: 0, hostile: 0 };
      }
      dailyStats[date].processed++;
      if (reply.was_posted) dailyStats[date].posted++;
      if (reply.classification === 'friendly') dailyStats[date].friendly++;
      if (reply.classification === 'neutral') dailyStats[date].neutral++;
      if (reply.classification === 'hostile') dailyStats[date].hostile++;
    }

    // Fill in missing days
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
 * Performance metrics (response times, model usage)
 */
router.get('/performance', async (req, res: Response) => {
  try {
    const { accountId } = (req as AuthenticatedRequest).auth;

    const { data, error } = await getSupabase()
      .from('reply_history')
      .select('processing_time_ms, model_used')
      .eq('account_id', accountId)
      .not('processing_time_ms', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    const times = (data || [])
      .map(r => r.processing_time_ms)
      .filter((t): t is number => t !== null);

    const modelUsage: Record<string, number> = {};
    for (const reply of data || []) {
      if (reply.model_used) {
        modelUsage[reply.model_used] = (modelUsage[reply.model_used] || 0) + 1;
      }
    }

    const avgTime = times.length > 0
      ? times.reduce((a, b) => a + b, 0) / times.length
      : 0;

    const p50 = times.length > 0
      ? times.sort((a, b) => a - b)[Math.floor(times.length * 0.5)]
      : 0;

    const p95 = times.length > 0
      ? times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)]
      : 0;

    res.json({
      performance: {
        avgProcessingTime: Math.round(avgTime),
        p50ProcessingTime: p50,
        p95ProcessingTime: p95,
        totalMeasured: times.length,
        modelUsage,
      },
    });
  } catch (error) {
    console.error('[Analytics] Failed to get performance:', error);
    res.status(500).json({ error: 'Failed to get performance' });
  }
});

export default router;
