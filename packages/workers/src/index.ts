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
import {
  replyMonitorWorker,
  replyMonitorQueue,
  scheduleMonitoringJobs,
} from './jobs/reply-monitor.js';

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for ioredis
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Post Scheduler Queue
export const postSchedulerQueue = new Queue('post-scheduler', { connection });

// Voice Processor Queue
export const voiceProcessorQueue = new Queue('voice-processor', { connection });

// Post Scheduler Worker
const postSchedulerWorker = new Worker(
  'post-scheduler',
  async (job) => {
    const { scheduledPostId } = job.data;
    console.log(`[PostScheduler] Publishing scheduled post: ${scheduledPostId}`);

    // TODO: Implement post scheduling logic
    // 1. Load scheduled post from Supabase
    // 2. Publish to Threads API
    // 3. Update status in Supabase
  },
  { connection }
);

postSchedulerWorker.on('completed', (job) => {
  console.log(`[PostScheduler] Job ${job.id} completed`);
});

postSchedulerWorker.on('failed', (job, err) => {
  console.error(`[PostScheduler] Job ${job?.id} failed:`, err.message);
});

// Voice Processor Worker
const voiceProcessorWorker = new Worker(
  'voice-processor',
  async (job) => {
    const { accountId, documentId, storagePath } = job.data;
    console.log(
      `[VoiceProcessor] Processing document ${documentId} for account ${accountId}`
    );

    // TODO: Implement voice processing logic
    // 1. Download document from Supabase Storage
    // 2. Chunk document into examples
    // 3. Generate embeddings via OpenRouter
    // 4. Store in voice_examples table
  },
  { connection }
);

voiceProcessorWorker.on('completed', (job) => {
  console.log(`[VoiceProcessor] Job ${job.id} completed`);
});

voiceProcessorWorker.on('failed', (job, err) => {
  console.error(`[VoiceProcessor] Job ${job?.id} failed:`, err.message);
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
  // TODO: Query scheduled_posts where scheduled_for <= now and status = 'pending'
  // Add jobs for each
});

console.log('[Workers] All workers started');
console.log('[Workers] Cron schedulers running');

// Graceful shutdown
async function shutdown() {
  console.log('[Workers] Shutting down...');
  await replyMonitorWorker.close();
  await postSchedulerWorker.close();
  await voiceProcessorWorker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Export for testing
export { replyMonitorQueue, replyMonitorWorker };
