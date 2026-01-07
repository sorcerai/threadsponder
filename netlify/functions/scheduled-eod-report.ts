/**
 * Netlify Scheduled Function: EOD Report Generation
 *
 * Runs daily at 5 PM UTC to generate End-of-Day reports for all active accounts.
 * Schedule configured in netlify.toml: "0 17 * * *"
 *
 * Multi-tenant aware: iterates through all accounts and generates reports per account.
 */

import { Config, Context } from '@netlify/functions';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  generateDailyReport,
  storeReport,
} from '../../packages/api/src/services/eod-report-service.js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * Get all active accounts that should receive EOD reports
 */
async function getActiveAccounts(supabase: SupabaseClient): Promise<string[]> {
  // Get accounts that have had activity in the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: activeAccounts, error } = await supabase
    .from('accounts')
    .select('id')
    .eq('status', 'active');

  if (error) {
    console.error('[EOD] Error fetching active accounts:', error);
    return [];
  }

  return (activeAccounts || []).map((a) => a.id);
}

/**
 * Generate and store EOD report for a single account
 */
async function processAccount(
  supabase: SupabaseClient,
  accountId: string,
  targetDate: Date
): Promise<{ success: boolean; totalReplies: number }> {
  try {
    const report = await generateDailyReport(supabase, accountId, targetDate);
    await storeReport(supabase, accountId, report);

    console.log(
      `[EOD] Generated report for account ${accountId}: ${report.summary.totalReplies} replies`
    );

    return { success: true, totalReplies: report.summary.totalReplies };
  } catch (error) {
    console.error(`[EOD] Error processing account ${accountId}:`, error);
    return { success: false, totalReplies: 0 };
  }
}

/**
 * Main scheduled function handler
 */
export default async function handler(req: Request, context: Context) {
  const startTime = Date.now();
  console.log('[EOD] Starting scheduled EOD report generation...');

  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[EOD] Missing required environment variables');
    return new Response(
      JSON.stringify({ error: 'Missing configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = getSupabase();
  const targetDate = new Date();

  try {
    // Get all active accounts
    const accountIds = await getActiveAccounts(supabase);
    console.log(`[EOD] Found ${accountIds.length} active accounts`);

    if (accountIds.length === 0) {
      console.log('[EOD] No active accounts to process');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No active accounts',
          duration: Date.now() - startTime,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Process each account
    const results = await Promise.allSettled(
      accountIds.map((id) => processAccount(supabase, id, targetDate))
    );

    // Summarize results
    const successful = results.filter(
      (r) => r.status === 'fulfilled' && r.value.success
    ).length;
    const failed = results.length - successful;
    const totalReplies = results.reduce((sum, r) => {
      if (r.status === 'fulfilled' && r.value.success) {
        return sum + r.value.totalReplies;
      }
      return sum;
    }, 0);

    const summary = {
      success: true,
      accounts: {
        total: accountIds.length,
        successful,
        failed,
      },
      totalReplies,
      date: targetDate.toISOString().split('T')[0],
      duration: Date.now() - startTime,
    };

    console.log('[EOD] Completed:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[EOD] Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Netlify Scheduled Function Configuration
 * Runs daily at 5 PM UTC (17:00)
 */
export const config: Config = {
  schedule: '0 17 * * *',
};
