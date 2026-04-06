/**
 * Metrics Collector Job
 *
 * Per-tenant job that:
 * 1. Fetches metrics for focused posts via the Threads API
 * 2. Stores snapshots in the post_metrics SQLite table
 */

import { getDb, ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';

async function collectPostMetrics(
  client: ThreadsClient,
  accountId: string,
  focusedPostId: string,
  threadsPostId: string
): Promise<boolean> {
  try {
    const result = await client.getPostMetrics(threadsPostId);
    if (!result.success || !result.metrics) return false;

    const db = getDb();
    db.prepare(`
      INSERT INTO post_metrics (account_id, focused_post_id, views, likes, replies, quotes, reposts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      focusedPostId,
      result.metrics.views,
      result.metrics.likes,
      result.metrics.replies,
      result.metrics.quotes,
      result.metrics.reposts
    );

    console.log(
      `[MetricsCollector] Collected metrics for ${threadsPostId}: ${result.metrics.views} views`
    );
    return true;
  } catch (error) {
    console.error(`[MetricsCollector] Error for ${threadsPostId}:`, error);
    return false;
  }
}

export async function runMetricsCollector(
  accountId: string,
  threadsAccountId: string
): Promise<{ collected: number }> {
  console.log(`[MetricsCollector] Processing tenant ${accountId}`);

  const tenantService = getTenantService();
  const credentials = tenantService.getThreadsCredentials(threadsAccountId);
  if (!credentials) {
    console.error(`[MetricsCollector] Failed to load credentials for ${threadsAccountId}`);
    return { collected: 0 };
  }

  const client = new ThreadsClient({
    accessToken: credentials.accessToken,
    userId: credentials.userId,
  });

  const db = getDb();
  const focusedPosts = db
    .prepare(
      'SELECT id, threads_post_id FROM focused_posts WHERE account_id = ? AND threads_account_id = ? AND is_active = 1'
    )
    .all(accountId, threadsAccountId) as Array<{ id: string; threads_post_id: string }>;

  let collected = 0;
  for (const post of focusedPosts) {
    const success = await collectPostMetrics(client, accountId, post.id, post.threads_post_id);
    if (success) collected++;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[MetricsCollector] Collected ${collected} metric snapshots for ${accountId}`);
  return { collected };
}

/**
 * Run metrics collection for all active tenants.
 * Called by cron periodically.
 */
export async function scheduleMetricsJobs(): Promise<number> {
  const tenantService = getTenantService();
  const activeTenants = tenantService.getActiveTenants();

  let ran = 0;
  for (const tenant of activeTenants) {
    try {
      await runMetricsCollector(tenant.accountId, tenant.threadsAccountId);
      ran++;
    } catch (error) {
      console.error(`[MetricsCollector] Error for ${tenant.accountId}:`, error);
    }
  }

  console.log(`[MetricsCollector] Ran metrics for ${ran}/${activeTenants.length} tenants`);
  return ran;
}
