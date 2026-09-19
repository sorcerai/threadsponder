/**
 * Threadsponder Workers
 *
 * Direct cron-based job execution — no queue required.
 * Jobs run in-process on a schedule.
 */

import cron from 'node-cron';
import http from 'http';
import { scheduleMonitoringJobs } from './jobs/reply-monitor.js';
import { scheduleDuePosts } from './jobs/post-scheduler.js';
import { scheduleMetricsJobs } from './jobs/metrics-collector.js';
import { scheduleDiscoveryJobs } from './jobs/discovery.js';
import { pruneOperatorQueues } from '@threadsponder/shared';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Health check server
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(PORT, () => {
  console.log(`[Workers] Health server listening on port ${PORT}`);
});

// Reply monitoring — every minute
cron.schedule('* * * * *', async () => {
  console.log('[Scheduler] Running reply monitor...');
  try {
    await scheduleMonitoringJobs();
  } catch (error) {
    console.error('[Scheduler] Reply monitor failed:', error);
  }
});

// Post publishing — every minute
cron.schedule('* * * * *', async () => {
  console.log('[Scheduler] Checking for due scheduled posts...');
  try {
    await scheduleDuePosts();
  } catch (error) {
    console.error('[Scheduler] Post scheduler failed:', error);
  }
});

// Metrics collection — every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scheduler] Running metrics collection...');
  try {
    await scheduleMetricsJobs();
  } catch (error) {
    console.error('[Scheduler] Metrics collector failed:', error);
  }
});

cron.schedule('*/5 * * * *', async () => {
  try {
    await scheduleDiscoveryJobs();
  } catch {
    console.error('[Scheduler] Discovery failed');
  }
});

console.log('[Workers] All cron jobs scheduled');

// Operator-queue retention — daily; keeps answered/expired inference rows,
// reviewed discovery candidates and decided replies from growing forever.
cron.schedule('0 3 * * *', () => {
  try {
    const pruned = pruneOperatorQueues();
    console.log('[Scheduler] Pruned operator queues:', JSON.stringify(pruned));
  } catch (error) {
    console.error('[Scheduler] Queue retention failed:', error);
  }
});

// Graceful shutdown
function shutdown() {
  console.log('[Workers] Shutting down...');
  healthServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
