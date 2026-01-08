/**
 * Threadsponder API
 *
 * Serverless-compatible Express API for the Threadsponder SaaS platform.
 * Designed for Netlify Functions deployment.
 *
 * Architecture:
 * - API (this package): Stateless HTTP endpoints, Supabase queries
 * - Workers (separate package): BullMQ jobs, reply monitoring, agent runtime
 */

// Route imports
import analyticsRouter from './routes/analytics.js';
import friendsRouter from './routes/friends.js';
import finetuneRouter from './routes/finetune.js';
import authRouter from './routes/auth.js';
import threadsRouter from './routes/threads.js';
import statsRouter from './routes/stats.js';
import reportsRouter from './routes/reports.js';
import postsRouter from './routes/posts.js';
import billingRouter from './routes/billing.js';
import voiceRouter from './routes/voice.js';

// Webhook imports
import clerkWebhookRouter from './routes/webhooks/clerk.js';

// Security utilities from shared package
import {
  createSecureCors,
  securityHeaders,
  createApiRateLimiter,
  createSafeLogger,
  // Multi-tenant Redis utilities
  tenantKeys,
  tenantPattern,
  TTL,
  getRedisClient,
} from '@threadsponder/shared';

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { Express, Request, Response } from 'express';
import type { Router } from 'express';

// ES module dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Detect serverless environment (Netlify, AWS Lambda, Vercel, etc.)
const isServerless = !!(
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.VERCEL ||
  process.env.SERVERLESS
);

// Configure logger - console-only for serverless
const logger = createSafeLogger();

// Create Express app
export const app: Express = express();

// Security middleware - CORS with allowed origins
// Note: Cast through unknown due to @types/express version mismatch between packages
app.use(createSecureCors([
  'http://localhost:3000',
  'http://localhost:3008',
  'http://localhost:5173',
  process.env.DASHBOARD_URL,
  process.env.FRONTEND_URL
].filter(Boolean) as string[]) as unknown as express.RequestHandler);

// Security headers (XSS protection, HSTS, CSP, etc.)
app.use(securityHeaders() as unknown as express.RequestHandler);

// Rate limiting for API endpoints
app.use('/api', createApiRateLimiter() as unknown as express.RequestHandler);

app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), serverless: isServerless });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', uptime: process.uptime(), serverless: isServerless });
});

// Mount modular route modules
app.use('/api/analytics', analyticsRouter as Router);
app.use('/api/friends', friendsRouter as Router);
app.use('/api/finetune', finetuneRouter as Router);
app.use('/api/auth', authRouter as Router);
app.use('/api/threads', threadsRouter as Router);
app.use('/api/stats', statsRouter as Router);
app.use('/api/reports', reportsRouter as Router);
app.use('/api/posts', postsRouter as Router);
app.use('/api/billing', billingRouter as Router);
app.use('/api/voice', voiceRouter as Router);

// Webhook routes (no auth required - signature verification in handlers)
app.use('/api/webhooks/clerk', clerkWebhookRouter as Router);

// Global IO mock (Socket.io removed for serverless compatibility)
// Dashboard uses React Query polling fallback (refetchInterval: 60000)
export const io: {
  emit: (...args: unknown[]) => void;
  on: (...args: unknown[]) => void;
  to: (room: string) => { emit: (...args: unknown[]) => void };
} = {
  emit: () => { },
  on: () => { },
  to: () => ({ emit: () => { } })
};

/**
 * Get organization ID from request context.
 * In production, this comes from Clerk auth middleware.
 * For development, fallback to header/query param.
 */
export function getOrgId(req: Request): string {
  // Priority: 1. Clerk auth context (via middleware), 2. Header, 3. Query param, 4. Default dev org
  const authReq = req as Request & { auth?: { orgId?: string } };
  const orgId = authReq.auth?.orgId
    || (req.headers['x-org-id'] as string)
    || (req.query.org_id as string)
    || process.env.DEFAULT_ORG_ID
    || 'dev-org-default';
  return orgId;
}

// ============================================
// Legacy endpoints - stub implementations
// (Real work is done by workers package)
// ============================================

// Supabase client for database queries
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Pending replies - query from Supabase instead of memory
app.get('/api/replies/pending', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('threads_replies')
      .select('*')
      .eq('organization_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({ success: true, replies: data || [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Reply stats - query from Supabase
app.get('/api/replies/stats', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const supabase = getSupabase();

    // Get counts by status
    const { data: pending } = await supabase
      .from('threads_replies')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'pending');

    const { data: replied } = await supabase
      .from('threads_replies')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'replied');

    res.json({
      success: true,
      stats: {
        pendingReview: pending || 0,
        totalReplied: replied || 0
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Pause/resume - update Redis control flag
app.post('/api/pause', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();
    const paused = req.body.paused ? 'true' : 'false';

    await redis.set(tenantKeys.control.paused(orgId), paused);

    res.json({ success: true, paused: req.body.paused });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Focus mode - get focused posts from Redis
app.get('/api/focus', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();

    // Get focused post IDs from Redis set
    const focusedIds = await redis.smembers(tenantKeys.focus.active(orgId));

    if (focusedIds.length === 0) {
      return res.json({
        success: true,
        mode: 'general',
        postIds: [],
        posts: []
      });
    }

    // Get post details for each focused ID
    const posts: Array<{
      id: string;
      text: string;
      urls: { permalinkNet: string };
      targetClassifications: string[];
    }> = [];

    for (const id of focusedIds) {
      const textResult = await redis.hget(tenantKeys.cache.postText(orgId, id), 'text');
      const text: string = typeof textResult === 'string' ? textResult : '';
      const classificationsResult = await redis.hget(tenantKeys.focus.meta(orgId, id), 'targetClassifications');
      const classificationsRaw: string | null = typeof classificationsResult === 'string' ? classificationsResult : null;
      const targetClassifications = classificationsRaw
        ? JSON.parse(classificationsRaw)
        : ['hostile', 'friendly', 'neutral'];

      posts.push({
        id,
        text: text || '',
        urls: {
          permalinkNet: `https://www.threads.net/post/${id}`
        },
        targetClassifications
      });
    }

    res.json({
      success: true,
      mode: 'focused',
      postIds: focusedIds,
      posts
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Set focus mode
app.post('/api/focus', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();
    const { urls, clear, remove } = req.body;

    // Clear focus mode
    if (clear) {
      const currentFocus = await redis.smembers(tenantKeys.focus.active(orgId));
      for (const id of currentFocus) {
        await redis.del(tenantKeys.focus.urls(orgId, id));
        await redis.del(tenantKeys.focus.meta(orgId, id));
      }
      await redis.del(tenantKeys.focus.active(orgId));

      return res.json({ success: true, mode: 'general', postIds: [] });
    }

    // Remove a single post from focus
    if (remove) {
      await redis.srem(tenantKeys.focus.active(orgId), remove);
      await redis.del(tenantKeys.focus.urls(orgId, remove));
      await redis.del(tenantKeys.focus.meta(orgId, remove));

      const remaining = await redis.smembers(tenantKeys.focus.active(orgId));
      const mode = remaining.length > 0 ? 'focused' : 'general';

      return res.json({ success: true, mode, postIds: remaining });
    }

    // Set focus mode with URLs/IDs
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'Provide urls array, remove id, or clear: true' });
    }

    const postIds: string[] = [];

    for (const url of urls) {
      // Extract post ID from URL
      const numericMatch = url.match(/\/post\/(\d+)/);
      const shortcodeMatch = url.match(/\/@[^\/]+\/post\/([A-Za-z0-9_-]+)/);

      const id = numericMatch?.[1] || shortcodeMatch?.[1] || (/^\d+$/.test(url) ? url : null);

      if (id) {
        postIds.push(id);
        await redis.sadd(tenantKeys.focus.active(orgId), id);
        await redis.hset(tenantKeys.focus.urls(orgId, id), {
          numericId: id,
          permalinkNet: `https://www.threads.net/post/${id}`,
          storedAt: Date.now().toString()
        });
      }
    }

    res.json({
      success: true,
      mode: 'focused',
      postIds
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Update focus classifications
app.patch('/api/focus/:postId/classifications', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();
    const { postId } = req.params;
    const { targetClassifications } = req.body;

    // Validate classifications
    const validClassifications = ['hostile', 'friendly', 'neutral'];
    if (!Array.isArray(targetClassifications) ||
        !targetClassifications.every((c: string) => validClassifications.includes(c))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid classifications. Must be array of: hostile, friendly, neutral'
      });
    }

    // Check if post is focused
    const isFocused = await redis.sismember(tenantKeys.focus.active(orgId), postId);
    if (!isFocused) {
      return res.status(404).json({ success: false, error: 'Post not found in focused posts' });
    }

    // Store classifications
    await redis.hset(tenantKeys.focus.meta(orgId, postId), { targetClassifications: JSON.stringify(targetClassifications) });

    res.json({ success: true, postId, targetClassifications });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Reply mode - get/set from Redis
app.get('/api/reply-mode', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();

    const mode = await redis.get(tenantKeys.control.mode(orgId)) || 'all';
    const focusedIds = await redis.smembers(tenantKeys.focus.active(orgId));

    res.json({
      success: true,
      replyMode: mode,
      isFocusMode: focusedIds.length > 0
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

app.post('/api/reply-mode', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();
    const { mode } = req.body;

    const validModes = ['all', 'hostile_only', 'friendly_only', 'match_energy'];
    if (!mode || !validModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: `Invalid mode. Must be one of: ${validModes.join(', ')}`
      });
    }

    await redis.set(tenantKeys.control.mode(orgId), mode);

    res.json({ success: true, replyMode: mode });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// Overview endpoint for dashboard
app.get('/api/overview', async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const redis = await getRedisClient();
    const supabase = getSupabase();

    // Get stats from Supabase
    const { count: pendingCount } = await supabase
      .from('threads_replies')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'pending');

    const { count: repliedCount } = await supabase
      .from('threads_replies')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'replied');

    // Get Redis stats
    const paused = await redis.get(tenantKeys.control.paused(orgId)) === 'true';
    const friendCount = await redis.scard(tenantKeys.friends.list(orgId));
    const sourceCount = await redis.scard(tenantKeys.rag.sources(orgId));
    const focusedIds = await redis.smembers(tenantKeys.focus.active(orgId));

    res.json({
      success: true,
      overview: {
        status: paused ? 'paused' : 'active',
        uptime: process.uptime(),
        repliesHandled: repliedCount || 0,
        pendingReview: pendingCount || 0,
        friendCount,
        documentSources: sourceCount,
        focusedPosts: focusedIds.length,
        serverless: isServerless
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// ============================================
// Bootstrap function for Netlify Functions
// ============================================

let isInitialized = false;

/**
 * Initialize the API for serverless deployment.
 * Called once per cold start.
 */
export async function bootstrap(startServer = false): Promise<{ app: Express; io: typeof io }> {
  if (isInitialized && !startServer) {
    return { app, io };
  }

  logger.info(`Initializing API (serverless: ${isServerless}, startServer: ${startServer})`);

  // Validate required environment variables
  const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
  const missingVars = requiredVars.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    logger.warn(`Missing environment variables: ${missingVars.join(', ')}`);
  }

  isInitialized = true;

  // Start server if running standalone
  if (startServer && !isServerless) {
    const port = process.env.PORT || process.env.DASHBOARD_PORT || 3008;
    app.listen(port, () => {
      logger.info(`API running on http://localhost:${port}`);
    });
  }

  return { app, io };
}

// Start if running standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrap(true).catch(err => {
    logger.error('Startup error:', err);
    process.exit(1);
  });
}
