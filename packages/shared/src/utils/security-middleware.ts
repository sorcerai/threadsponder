/**
 * Security Middleware for Express APIs
 *
 * Provides CORS, security headers, and rate limiting middleware.
 *
 * Security Experts:
 * - Parisa Tabriz (Google Chrome) - XSS, CORS, client-side attacks
 * - James Kettle (PortSwigger) - HTTP Security Research
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import cors, { CorsOptions } from 'cors';
import rateLimit from 'express-rate-limit';

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

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  message?: string;
}

/**
 * Create an in-memory rate limiter middleware using express-rate-limit.
 * Suitable for single-process deployments.
 */
export function createRateLimiter(config: RateLimitConfig): RequestHandler {
  const {
    maxRequests = 100,
    windowMs = 60000,
    keyGenerator = (req) => req.ip || 'unknown',
    message = 'Too many requests, please try again later',
  } = config;

  return rateLimit({
    windowMs,
    max: maxRequests,
    keyGenerator: keyGenerator as any,
    standardHeaders: true,
    legacyHeaders: false,
    message: JSON.stringify({ error: message }),
  }) as unknown as RequestHandler;
}

/**
 * API rate limiter — 100 requests per minute per IP.
 */
export function createApiRateLimiter(): RequestHandler {
  return createRateLimiter({ windowMs: 60 * 1000, maxRequests: 100 });
}

/** Auth rate limiter — 10 attempts per minute per IP. */
export function createAuthRateLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: 'Too many authentication attempts, please try again later',
  });
}

/** Webhook rate limiter — 50 per minute per org ID or IP. */
export function createWebhookRateLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 50,
    keyGenerator: (req) => (req.headers['x-org-id'] as string) || req.ip || 'unknown',
    message: 'Webhook rate limit exceeded',
  });
}

/**
 * XSS escape function for HTML output.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';

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
