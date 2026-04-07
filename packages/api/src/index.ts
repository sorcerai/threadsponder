/**
 * Threadsponder API
 *
 * Express API for the Threadsponder open-source project.
 * SQLite backend — zero external dependencies required.
 *
 * Architecture:
 * - API (this package): Stateless HTTP endpoints, SQLite queries
 * - Workers (separate package): Background jobs, reply monitoring, agent runtime
 */

// Route imports
import analyticsRouter from "./routes/analytics.js";
import friendsRouter from "./routes/friends.js";
import finetuneRouter from "./routes/finetune.js";
import authRouter from "./routes/auth.js";
import threadsRouter from "./routes/threads.js";
import statsRouter from "./routes/stats.js";
import reportsRouter from "./routes/reports.js";
import postsRouter from "./routes/posts.js";
import billingRouter from "./routes/billing.js";
import voiceRouter from "./routes/voice.js";

import { authMiddleware } from "./middleware/auth.js";

// Security utilities from shared package
import {
  createSecureCors,
  securityHeaders,
  createApiRateLimiter,
  createSafeLogger,
  getDb,
} from "@threadsponder/shared";

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import express, { Express, Request, Response } from "express";
import type { Router } from "express";

// Load environment variables
dotenv.config();

// Detect serverless environment (Netlify, AWS Lambda, Vercel, etc.)
const isServerless = !!(
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.VERCEL ||
  process.env.SERVERLESS
);

// Configure logger
const logger = createSafeLogger();

// Create Express app
export const app: Express = express();

// Security middleware - CORS with allowed origins
app.use(
  createSecureCors(
    [
      "http://localhost:3000",
      "http://localhost:3008",
      "http://localhost:5173",
      process.env.DASHBOARD_URL,
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[],
  ) as unknown as express.RequestHandler,
);

// Security headers (XSS protection, HSTS, CSP, etc.)
app.use(securityHeaders() as unknown as express.RequestHandler);

// Rate limiting for API endpoints
app.use("/api", createApiRateLimiter() as unknown as express.RequestHandler);

app.use(express.json());

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    serverless: isServerless,
  });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    serverless: isServerless,
  });
});

// Mount modular route modules (protected by authMiddleware)
app.use("/api/analytics", authMiddleware, analyticsRouter as Router);
app.use("/api/friends", authMiddleware, friendsRouter as Router);
app.use("/api/finetune", authMiddleware, finetuneRouter as Router);
app.use("/api/threads", authMiddleware, threadsRouter as Router);
app.use("/api/stats", authMiddleware, statsRouter as Router);
app.use("/api/reports", authMiddleware, reportsRouter as Router);
app.use("/api/posts", authMiddleware, postsRouter as Router);
app.use("/api/billing", authMiddleware, billingRouter as Router);
app.use("/api/voice", authMiddleware, voiceRouter as Router);

// Public routes (no auth required)
app.use("/api/auth", authRouter as Router);

// Global IO mock (Socket.io removed for serverless compatibility)
// Dashboard uses React Query polling fallback (refetchInterval: 60000)
export const io: {
  emit: (...args: unknown[]) => void;
  on: (...args: unknown[]) => void;
  to: (room: string) => { emit: (...args: unknown[]) => void };
} = {
  emit: () => {},
  on: () => {},
  to: () => ({ emit: () => {} }),
};

// Overview endpoint — SQLite-based dashboard summary
app.get(
  "/api/overview",
  authMiddleware,
  (req: Request, res: Response) => {
    try {
      const auth = (req as Request & { auth?: { accountId?: string } }).auth;
      const accountId = auth?.accountId;

      if (!accountId) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      const db = getDb();

      const repliedCount = (db.prepare(
        "SELECT COUNT(*) as count FROM reply_history WHERE account_id = ? AND replied = 1"
      ).get(accountId) as { count: number }).count;

      const activePosts = (db.prepare(
        "SELECT COUNT(*) as count FROM focused_posts WHERE account_id = ? AND is_active = 1"
      ).get(accountId) as { count: number }).count;

      const friendCount = (db.prepare(
        "SELECT COUNT(*) as count FROM friends WHERE account_id = ?"
      ).get(accountId) as { count: number }).count;

      res.json({
        success: true,
        overview: {
          status: "active",
          uptime: process.uptime(),
          repliesHandled: repliedCount,
          pendingReview: 0,
          friendCount,
          documentSources: 0,
          focusedPosts: activePosts,
          serverless: isServerless,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  },
);

// ============================================
// Bootstrap function
// ============================================

let isInitialized = false;

/**
 * Initialize the API. Called once per cold start.
 */
export async function bootstrap(
  startServer = false,
): Promise<{ app: Express; io: typeof io }> {
  if (isInitialized && !startServer) {
    return { app, io };
  }

  logger.info(
    `Initializing API (serverless: ${isServerless}, startServer: ${startServer})`,
  );

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
  bootstrap(true).catch((err) => {
    logger.error("Startup error:", err);
    process.exit(1);
  });
}
