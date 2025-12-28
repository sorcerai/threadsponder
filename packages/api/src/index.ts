/**
 * Threadsponder API Server
 *
 * Express server with Clerk auth and Supabase backend
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { clerkMiddleware } from '@clerk/express';

// Routes
import threadsRoutes from './routes/threads.js';
import voiceRoutes from './routes/voice.js';
import postsRoutes from './routes/posts.js';
import friendsRoutes from './routes/friends.js';
import analyticsRoutes from './routes/analytics.js';
import billingRoutes from './routes/billing.js';

// Middleware
import { authMiddleware } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for rate limiting behind load balancers
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'https://threadsponder.com',
    ],
    credentials: true,
  })
);

// Clerk middleware (must be before JSON parsing for webhook route)
app.use(clerkMiddleware());

// Special handling for Stripe webhook (needs raw body)
app.use(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' })
);

// JSON parsing for all other routes
app.use(express.json());

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'threadsponder-api', timestamp: new Date().toISOString() });
});

// API routes (all require auth except billing webhook)
app.use('/api/threads', authMiddleware, threadsRoutes);
app.use('/api/voice', authMiddleware, voiceRoutes);
app.use('/api/posts', authMiddleware, postsRoutes);
app.use('/api/friends', authMiddleware, friendsRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/billing', billingRoutes); // Has its own auth handling

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API] Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`[API] Server running on port ${PORT}`);
  console.log(`[API] Health check: http://localhost:${PORT}/health`);
});

export default app;
