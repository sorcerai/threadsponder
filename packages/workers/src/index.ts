import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';

// Parse Redis URL for ioredis
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Queue definitions
export const replyMonitorQueue = new Queue('reply-monitor', { connection });
export const postSchedulerQueue = new Queue('post-scheduler', { connection });
export const voiceProcessorQueue = new Queue('voice-processor', { connection });

// Reply Monitor Worker
const replyMonitorWorker = new Worker(
  'reply-monitor',
  async (job) => {
    const { tenantId, threadsAccountId } = job.data;
    console.log(`[ReplyMonitor] Processing job for tenant: ${tenantId}`);

    // TODO: Implement reply monitoring logic
    // 1. Load tenant config from Supabase
    // 2. Fetch replies from Threads API
    // 3. Classify and respond
  },
  { connection }
);

replyMonitorWorker.on('completed', (job) => {
  console.log(`[ReplyMonitor] Job ${job.id} completed`);
});

replyMonitorWorker.on('failed', (job, err) => {
  console.error(`[ReplyMonitor] Job ${job?.id} failed:`, err.message);
});

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
    console.log(`[VoiceProcessor] Processing document ${documentId} for account ${accountId}`);

    // TODO: Implement voice processing logic
    // 1. Download document from Supabase Storage
    // 2. Chunk document into examples
    // 3. Generate embeddings
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

console.log('[Workers] All workers started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Workers] Shutting down...');
  await replyMonitorWorker.close();
  await postSchedulerWorker.close();
  await voiceProcessorWorker.close();
  await connection.quit();
  process.exit(0);
});
