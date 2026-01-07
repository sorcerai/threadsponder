/**
 * Security Middleware for Express APIs
 *
 * Provides CORS, security headers, and rate limiting middleware.
 * Uses Upstash Redis for distributed rate limiting (serverless-compatible).
 *
 * Security Experts:
 * - Parisa Tabriz (Google Chrome) - XSS, CORS, client-side attacks
 * - James Kettle (PortSwigger) - HTTP Security Research
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import cors, { CorsOptions } from 'cors';
import { createUpstashRateLimiter } from './upstash-client.js';

/**
 * Secure CORS configuration.
 * Restricts origins to specific allowed domains instead of wildcard.
 */
export function createSecureCors(allowedOrigins?: string[]): RequestHandler {
  const origins = allowedOrigins || [
    'http://localhost:3000',
    'http://localhost:3008',
    'http://localhost:5173',
    process.env.DASHBOARD_URL,
    process.env.FRONTEND_URL
  ].filter(Boolean) as string[];

  const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    maxAge: 86400 // 24 hours
  };

  return cors(corsOptions);
}

/**
 * Security headers middleware.
 * Adds essential security headers to all responses.
 */
export function securityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS filter
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Content Security Policy (adjust for your needs)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://graph.threads.net https://openrouter.ai https://api.stripe.com"
    );

    // Strict Transport Security (for HTTPS)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Permissions Policy
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );

    next();
  };
}

/**
 * Redis-based rate limiter using Upstash.
 * Distributed rate limiting that works across serverless instances.
 */
interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  message?: string;
  type?: 'api' | 'auth' | 'webhook';
}

// Cache the rate limiter instances to avoid recreating on each request
const rateLimiterCache = new Map<string, ReturnType<typeof createUpstashRateLimiter>>();

/**
 * Create a Redis-backed rate limiter middleware.
 * Uses @upstash/ratelimit for distributed, serverless-compatible rate limiting.
 */
export function createRateLimiter(config: RateLimitConfig): RequestHandler {
  const {
    maxRequests = 100,
    windowMs = 60000,
    keyGenerator = (req) => req.ip || 'unknown',
    message = 'Too many requests, please try again later',
    type = 'api'
  } = config;

  // Convert ms to window format (e.g., 60000ms -> "1m")
  const windowMinutes = Math.ceil(windowMs / 60000);
  const window = `${windowMinutes}m` as `${number}m`;

  // Create cache key for this limiter config
  const cacheKey = `${type}:${maxRequests}:${window}`;

  // Get or create the rate limiter
  let rateLimiter = rateLimiterCache.get(cacheKey);
  if (!rateLimiter) {
    rateLimiter = createUpstashRateLimiter(type, { requests: maxRequests, window });
    rateLimiterCache.set(cacheKey, rateLimiter);
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = keyGenerator(req);

    try {
      const { success, limit, remaining, reset } = await rateLimiter!.limit(identifier);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil(reset / 1000).toString());

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        res.status(429).json({
          error: message,
          retryAfter: Math.max(1, retryAfter)
        });
        return;
      }

      next();
    } catch (error) {
      // If Redis is unavailable, log and allow request (fail-open for availability)
      // In production, you might want to fail-closed instead
      console.error('[RateLimit] Redis error, allowing request:', error);
      next();
    }
  };
}

/**
 * API-specific rate limiter with stricter limits for sensitive endpoints.
 * Uses Redis-backed distributed rate limiting.
 */
export function createApiRateLimiter(): RequestHandler {
  return createRateLimiter({
    type: 'api',
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,    // 100 requests per minute
    keyGenerator: (req) => {
      // Use API key if present, otherwise IP
      const apiKey = req.headers['x-api-key'] as string;
      return apiKey || req.ip || 'unknown';
    },
    message: 'API rate limit exceeded'
  });
}

/**
 * Strict rate limiter for authentication/validation endpoints.
 * Uses Redis-backed distributed rate limiting with stricter limits.
 */
export function createAuthRateLimiter(): RequestHandler {
  return createRateLimiter({
    type: 'auth',
    windowMs: 60 * 1000,  // 1 minute window for Redis (10 per minute)
    maxRequests: 10,       // 10 attempts per minute
    message: 'Too many authentication attempts, please try again later'
  });
}

/**
 * Rate limiter for webhook endpoints.
 * Uses Redis-backed distributed rate limiting.
 */
export function createWebhookRateLimiter(): RequestHandler {
  return createRateLimiter({
    type: 'webhook',
    windowMs: 60 * 1000,  // 1 minute
    maxRequests: 50,       // 50 webhooks per minute
    keyGenerator: (req) => {
      // Rate limit by org ID from webhook signature or IP
      const orgId = req.headers['x-org-id'] as string;
      return orgId || req.ip || 'unknown';
    },
    message: 'Webhook rate limit exceeded'
  });
}

/**
 * XSS escape function for HTML output.
 */
export function escapeHtml(str: string): string {
  if (!str || typeof str !== 'string') return '';

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Socket.io secure CORS options.
 */
export function getSocketCorsOptions(allowedOrigins?: string[]) {
  const origins = allowedOrigins || [
    'http://localhost:3000',
    'http://localhost:3008',
    'http://localhost:5173',
    process.env.DASHBOARD_URL,
    process.env.FRONTEND_URL
  ].filter(Boolean) as string[];

  return {
    cors: {
      origin: origins,
      methods: ['GET', 'POST'],
      credentials: true
    }
  };
}
