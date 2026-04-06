/**
 * Threadsponder Workers
 *
 * BullMQ workers for:
 * - Reply monitoring (per-tenant)
 * - Post scheduling
 * - Voice document processing
 */

import cron from 'node-cron';
import http from 'http';
import {
  replyMonitorWorker,
  replyMonitorQueue,
  scheduleMonitoringJobs,
} from './jobs/reply-monitor.js';
import {
  metricsCollectorWorker,
  metricsCollectorQueue,
  scheduleMetricsJobs,
} from './jobs/metrics-collector.js';
import {
  postSchedulerWorker,
  postSchedulerQueue,
  scheduleDuePosts,
} from './jobs/post-scheduler.js';
import {
  voiceProcessorWorker,
  voiceProcessorQueue,
} from './jobs/voice-processor.js';

const PORT = parseInt(process.env.PORT || '8080', 10);

// Health check server for Cloud Run
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

// Schedule reply monitoring every minute
cron.schedule('* * * * *', async () => {
  console.log('[Scheduler] Running reply monitor scheduling...');
  try {
    await scheduleMonitoringJobs();
  } catch (error) {
    console.error('[Scheduler] Failed to schedule monitoring jobs:', error);
  }
});

// Schedule post publishing check every minute
cron.schedule('* * * * *', async () => {
  console.log('[Scheduler] Checking for due scheduled posts...');
  try {
    await scheduleDuePosts();
  } catch (error) {
    console.error('[Scheduler] Failed to schedule due posts:', error);
  }
});

// Schedule metrics collection every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Scheduler] Running metrics collection scheduling...');
  try {
    await scheduleMetricsJobs();
  } catch (error) {
    console.error('[Scheduler] Failed to schedule metrics jobs:', error);
  }
});

// Workers are initialized by their module imports (reply-monitor, post-scheduler, voice-processor, metrics-collector)
console.log('[Workers] All workers started');
console.log('[Workers] Cron schedulers running');

// Graceful shutdown
async function shutdown() {
  console.log('[Workers] Shutting down...');
  await Promise.allSettled([
    replyMonitorWorker.close(),
    postSchedulerWorker.close(),
    voiceProcessorWorker.close(),
    metricsCollectorWorker.close(),
  ]);
  healthServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Export for testing
export {
  replyMonitorQueue, replyMonitorWorker,
  metricsCollectorQueue, metricsCollectorWorker,
  postSchedulerQueue, postSchedulerWorker,
  voiceProcessorQueue, voiceProcessorWorker,
};
