/**
 * Reports API Routes
 *
 * EOD reports generated from SQLite data.
 */

import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = Router();

interface ReportSummary {
  totalReplies: number;
  triggered: number;
  classifications: { hostile: number; friendly: number; neutral: number; skip: number };
  avgEffortRatio: number;
}

interface EODReport {
  date: string;
  summary: ReportSummary;
  patterns: Array<{ name: string; count: number }>;
  bestHours: Array<{ hour: number; count: number }>;
  weeklyTrend: Array<{ date: string; count: number }>;
}

function generateSimpleReport(accountId: string, date: Date): EODReport {
  const db = getDb();
  const dateStr = date.toISOString().split('T')[0];

  const rows = db.prepare(
    "SELECT classification, replied FROM reply_history WHERE account_id = ? AND date(created_at) = ?"
  ).all(accountId, dateStr) as Array<{ classification: string; replied: number }>;

  const summary: ReportSummary = {
    totalReplies: rows.length,
    triggered: 0,
    classifications: { hostile: 0, friendly: 0, neutral: 0, skip: 0 },
    avgEffortRatio: 0,
  };

  for (const r of rows) {
    if (r.replied) summary.triggered++;
    if (r.classification in summary.classifications) {
      summary.classifications[r.classification as keyof typeof summary.classifications]++;
    }
  }

  return { date: dateStr, summary, patterns: [], bestHours: [], weeklyTrend: [] };
}

function getAccountId(req: Request): string | null {
  const auth = (req as unknown as AuthenticatedRequest).auth;
  return auth?.accountId || null;
}

/**
 * GET /api/reports/eod
 * Fetch EOD report for a date (defaults to today)
 */
router.get('/eod', (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const dateParam = req.query.date as string | undefined;
    const targetDate = dateParam ? new Date(dateParam) : new Date();

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const report = generateSimpleReport(accountId, targetDate);

    return res.json({ success: true, report, regenerated: false });
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
router.post('/eod/generate', (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { date } = req.body;
    const targetDate = date ? new Date(date) : new Date();

    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const report = generateSimpleReport(accountId, targetDate);

    return res.json({ success: true, report, regenerated: true });
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
router.get('/eod/history', (_req: Request, res: Response) => {
  return res.json({ success: true, dates: [], count: 0 });
});

/**
 * GET /api/reports/eod/export
 * Export report as JSON or CSV
 */
router.get('/eod/export', (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const dateParam = req.query.date as string | undefined;
    const format = (req.query.format as 'json' | 'csv') || 'json';

    const targetDate = dateParam ? new Date(dateParam) : new Date();
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format' });
    }

    const report = generateSimpleReport(accountId, targetDate);
    const dateStr = targetDate.toISOString().split('T')[0];

    if (format === 'csv') {
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
