import { getDb, ThreadsClient } from '@threadsponder/shared';
import { getTenantService } from '../services/tenant.js';

let running = false;

/** Opt-in, read-only discovery. Candidates are never fed into the reply monitor. */
export async function scheduleDiscoveryJobs(): Promise<number> {
  if (running) return 0;
  running = true;
  let recorded = 0;
  try {
    const service = getTenantService();
    for (const tenant of service.getActiveTenants()) {
      try {
        const config = service.getTenantConfig(tenant.accountId);
        if (!config?.discoveryEnabled || !config.discoveryQueries.length) continue;
        const credentials = service.getThreadsCredentials(tenant.threadsAccountId);
        if (!credentials) continue;
        const client = new ThreadsClient(credentials);
        for (const query of config.discoveryQueries) {
          const posts = await client.searchPosts(query);
          for (const post of posts) {
            recorded += getDb().prepare(`INSERT OR IGNORE INTO discovery_candidates
              (account_id, threads_account_id, threads_post_id, query, payload) VALUES (?, ?, ?, ?, ?)`)
              .run(tenant.accountId, tenant.threadsAccountId, post.id, query, JSON.stringify(post)).changes;
          }
        }
      } catch {
        // Do not log transport errors, which can contain access tokens.
        console.error(`[Discovery] Search failed for account ${tenant.accountId}`);
      }
    }
    return recorded;
  } finally {
    running = false;
  }
}
