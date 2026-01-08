/**
 * Threadsponder Workers
 *
 * BullMQ workers for:
 * - Reply monitoring (per-tenant)
 * - Post scheduling
 * - Voice document processing
 */

import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
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

const REDIS_URL = process.env.UPSTASH_REDIS_URL || '';
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

// Lazy Redis connection - only initialize if REDIS_URL is configured
let _connection: IORedis | null = null;

function getConnection(): IORedis | null {
  if (!REDIS_URL) {
    console.warn('[Workers] UPSTASH_REDIS_URL not configured, Redis disabled');
    return null;
  }
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return _connection;
}

// Post Scheduler Queue - lazy init
let _postSchedulerQueue: Queue | null = null;
export function getPostSchedulerQueue(): Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_postSchedulerQueue) {
    _postSchedulerQueue = new Queue('post-scheduler', { connection: conn });
  }
  return _postSchedulerQueue;
}

// Voice Processor Queue - lazy init
let _voiceProcessorQueue: Queue | null = null;
export function getVoiceProcessorQueue(): Queue | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_voiceProcessorQueue) {
    _voiceProcessorQueue = new Queue('voice-processor', { connection: conn });
  }
  return _voiceProcessorQueue;
}

// Legacy exports for backward compatibility
export const postSchedulerQueue = null as unknown as Queue;
export const voiceProcessorQueue = null as unknown as Queue;

// Post Scheduler Worker - lazy init
let _postSchedulerWorker: Worker | null = null;
function getPostSchedulerWorker(): Worker | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_postSchedulerWorker) {
    _postSchedulerWorker = new Worker(
      'post-scheduler',
      async (job) => {
        const { scheduledPostId } = job.data;
        console.log(`[PostScheduler] Publishing scheduled post: ${scheduledPostId}`);
        // TODO: Implement post scheduling logic
      },
      { connection: conn }
    );
    _postSchedulerWorker.on('completed', (job) => {
      console.log(`[PostScheduler] Job ${job.id} completed`);
    });
    _postSchedulerWorker.on('failed', (job, err) => {
      console.error(`[PostScheduler] Job ${job?.id} failed:`, err.message);
    });
  }
  return _postSchedulerWorker;
}

// Voice Processor Worker - lazy init
let _voiceProcessorWorker: Worker | null = null;
function getVoiceProcessorWorker(): Worker | null {
  const conn = getConnection();
  if (!conn) return null;
  if (!_voiceProcessorWorker) {
    _voiceProcessorWorker = new Worker(
      'voice-processor',
      async (job) => {
        const { accountId, documentId, storagePath } = job.data;
        console.log(
          `[VoiceProcessor] Processing document ${documentId} for account ${accountId}`
        );
        // TODO: Implement voice processing logic
      },
      { connection: conn }
    );
    _voiceProcessorWorker.on('completed', (job) => {
      console.log(`[VoiceProcessor] Job ${job.id} completed`);
    });
    _voiceProcessorWorker.on('failed', (job, err) => {
      console.error(`[VoiceProcessor] Job ${job?.id} failed:`, err.message);
    });
  }
  return _voiceProcessorWorker;
}

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
  // TODO: Query scheduled_posts where scheduled_for <= now and status = 'pending'
  // Add jobs for each
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

// Initialize workers if Redis is configured
if (REDIS_URL) {
  getPostSchedulerWorker();
  getVoiceProcessorWorker();
  console.log('[Workers] All workers started');
} else {
  console.warn('[Workers] Redis not configured - workers disabled, only health server running');
}
console.log('[Workers] Cron schedulers running');

// Graceful shutdown
async function shutdown() {
  console.log('[Workers] Shutting down...');
  if (_postSchedulerWorker) await _postSchedulerWorker.close();
  if (_voiceProcessorWorker) await _voiceProcessorWorker.close();
  if (_connection) await _connection.quit();
  healthServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Export for testing
export { replyMonitorQueue, replyMonitorWorker, metricsCollectorQueue, metricsCollectorWorker };
