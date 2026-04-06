/**
 * Reports API Routes
 *
 * Endpoints for EOD reports and analytics exports:
 * - GET /api/reports/eod - Fetch EOD report for a date
 * - POST /api/reports/eod/generate - Force regenerate report
 * - GET /api/reports/eod/history - Get list of available reports
 * - GET /api/reports/eod/export - Export report as JSON/CSV
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  generateDailyReport,
  storeReport,
  getReportHistory,
  EODReport,
} from '../services/eod-report-service.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router: Router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

function getAccountId(req: Request): string | null {
  const auth = (req as unknown as AuthenticatedRequest).auth;
  return auth?.accountId || null;
}

/**
 * GET /api/reports/eod
 * Fetch EOD report for a date (defaults to today)
 */
router.get('/eod', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const dateParam = req.query.date as string | undefined;
    const compare = (req.query.compare as 'yesterday' | 'lastweek') || 'yesterday';

    const targetDate = dateParam ? new Date(dateParam) : new Date();
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const supabase = getSupabase();
    const report = await generateDailyReport(supabase, accountId, targetDate, compare);

    return res.json({
      success: true,
      report,
      regenerated: false,
    });
  } catch (error) {
    console.error('Error fetching EOD report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/reports/eod/generate
 * Force regenerate report for a date
 */
router.post('/eod/generate', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const supabase = getSupabase();
    const report = await generateDailyReport(supabase, accountId, targetDate);

    // Store the report
    await storeReport(supabase, accountId, report);

    return res.json({
      success: true,
      report,
      regenerated: true,
    });
  } catch (error) {
    console.error('Error generating EOD report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/reports/eod/history
 * Get list of dates with available reports
 */
router.get('/eod/history', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 7, 30);

    const supabase = getSupabase();
    const dates = await getReportHistory(supabase, accountId, limit);

    return res.json({
      success: true,
      dates,
      count: dates.length,
    });
  } catch (error) {
    console.error('Error fetching report history:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/reports/eod/export
 * Export report as JSON or CSV
 */
router.get('/eod/export', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const dateParam = req.query.date as string | undefined;
    const format = (req.query.format as 'json' | 'csv') || 'json';

    const targetDate = dateParam ? new Date(dateParam) : new Date();
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const supabase = getSupabase();
    const report = await generateDailyReport(supabase, accountId, targetDate);

    const dateStr = targetDate.toISOString().split('T')[0];

    if (format === 'csv') {
      // Generate CSV
      const csvLines = [
        'EOD Report,' + dateStr,
        '',
        'Summary',
        'Total Replies,' + report.summary.totalReplies,
        'Triggered,' + report.summary.triggered,
        'Hostile,' + report.summary.classifications.hostile,
        'Friendly,' + report.summary.classifications.friendly,
        'Neutral,' + report.summary.classifications.neutral,
        'Skip,' + report.summary.classifications.skip,
        'Avg Effort Ratio,' + report.summary.avgEffortRatio.toFixed(2),
        '',
        'Patterns',
        ...report.patterns.map(p => `${p.name},${p.count}`),
        '',
        'Best Hours',
        ...report.bestHours.map(h => `${h.hour}:00,${h.count}`),
        '',
        'Weekly Trend',
        ...report.weeklyTrend.map(t => `${t.date},${t.count}`),
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=eod-report-${dateStr}.csv`);
      return res.send(csvLines.join('\n'));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=eod-report-${dateStr}.json`);
      return res.json(report);
    }
  } catch (error) {
    console.error('Error exporting EOD report:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
