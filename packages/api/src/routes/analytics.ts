/**
 * Analytics Routes
 *
 * Reply history and dashboard metrics
 */

import express, { Response, Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router: Router = express.Router();

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
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

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

/**
 * GET /api/analytics/ghost
 * Ghost Analytics - Velocity and engagement metrics Meta doesn't show
 */
router.get('/ghost', async (req, res: Response) => {
  try {
    const { accountId } = (req as AuthenticatedRequest).auth;

    // Get account baseline
    const { data: baseline, error: baselineError } = await getSupabase()
      .from('account_velocity_baseline')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (baselineError && baselineError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('[Ghost Analytics] Baseline error:', baselineError);
    }

    // Get top performing posts (by velocity vs average)
    const { data: topPosts, error: postsError } = await getSupabase()
      .from('post_performance')
      .select(`
        post_id, post_text, posted_at,
        current_views, current_likes, current_replies, current_quotes,
        engagement_rate, velocity_vs_avg, engagement_vs_avg,
        peak_velocity, velocity_at_1h, velocity_at_6h,
        is_evergreen_candidate
      `)
      .eq('account_id', accountId)
      .not('velocity_vs_avg', 'is', null)
      .order('velocity_vs_avg', { ascending: false })
      .limit(10);

    if (postsError) throw postsError;

    // Get recent metrics snapshots for velocity trend
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: recentSnapshots, error: snapshotsError } = await getSupabase()
      .from('post_metrics')
      .select('post_id, views, velocity_score, engagement_rate, snapshot_at')
      .eq('account_id', accountId)
      .gte('snapshot_at', twentyFourHoursAgo.toISOString())
      .order('snapshot_at', { ascending: true });

    if (snapshotsError) throw snapshotsError;

    // Get evergreen candidates
    const { data: evergreenCandidates, error: evergreenError } = await getSupabase()
      .from('post_performance')
      .select('post_id, post_text, posted_at, engagement_rate, current_views')
      .eq('account_id', accountId)
      .eq('is_evergreen_candidate', true)
      .order('engagement_rate', { ascending: false })
      .limit(5);

    if (evergreenError) throw evergreenError;

    // Calculate overall stats
    const avgEngagement = baseline?.avg_engagement_rate ?? 0;
    const avgVelocity1h = baseline?.avg_velocity_1h ?? 0;

    // Format top posts for display
    const formattedPosts = (topPosts || []).map(post => ({
      postId: post.post_id,
      text: post.post_text?.substring(0, 100) + (post.post_text && post.post_text.length > 100 ? '...' : ''),
      postedAt: post.posted_at,
      views: post.current_views,
      likes: post.current_likes,
      replies: post.current_replies,
      engagementRate: post.engagement_rate ? (post.engagement_rate * 100).toFixed(2) : null,
      velocityVsAvg: post.velocity_vs_avg ? post.velocity_vs_avg.toFixed(1) : null,
      engagementVsAvg: post.engagement_vs_avg ? post.engagement_vs_avg.toFixed(1) : null,
      isHot: post.velocity_vs_avg && post.velocity_vs_avg > 2,
      isEvergreen: post.is_evergreen_candidate,
    }));

    // Group snapshots by hour for trend chart
    const hourlyTrend: Record<string, { views: number; velocity: number; count: number }> = {};
    for (const snapshot of recentSnapshots || []) {
      const hour = new Date(snapshot.snapshot_at).toISOString().substring(0, 13) + ':00';
      if (!hourlyTrend[hour]) {
        hourlyTrend[hour] = { views: 0, velocity: 0, count: 0 };
      }
      hourlyTrend[hour].views += snapshot.views || 0;
      hourlyTrend[hour].velocity += snapshot.velocity_score || 0;
      hourlyTrend[hour].count++;
    }

    const trendData = Object.entries(hourlyTrend)
      .map(([hour, data]) => ({
        hour,
        totalViews: data.views,
        avgVelocity: data.count > 0 ? (data.velocity / data.count).toFixed(2) : '0',
      }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    res.json({
      success: true,
      ghost: {
        baseline: {
          avgVelocity1h: avgVelocity1h.toFixed(1),
          avgVelocity6h: baseline?.avg_velocity_6h?.toFixed(1) ?? '0',
          avgVelocity24h: baseline?.avg_velocity_24h?.toFixed(1) ?? '0',
          avgEngagementRate: (avgEngagement * 100).toFixed(2),
          sampleCount: baseline?.sample_count ?? 0,
          hasEnoughData: (baseline?.sample_count ?? 0) >= 5,
        },
        topPosts: formattedPosts,
        hourlyTrend: trendData,
        evergreenCandidates: (evergreenCandidates || []).map(p => ({
          postId: p.post_id,
          text: p.post_text?.substring(0, 80) + '...',
          postedAt: p.posted_at,
          engagementRate: p.engagement_rate ? (p.engagement_rate * 100).toFixed(2) : null,
          views: p.current_views,
        })),
        hasData: (topPosts?.length ?? 0) > 0 || (recentSnapshots?.length ?? 0) > 0,
      },
    });
  } catch (error) {
    console.error('[Ghost Analytics] Failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get ghost analytics' });
  }
});

export default router;
