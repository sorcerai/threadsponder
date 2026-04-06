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

console.log('[Workers] All cron jobs scheduled');

// Graceful shutdown
function shutdown() {
  console.log('[Workers] Shutting down...');
  healthServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
