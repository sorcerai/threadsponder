/**
 * Safe Logger Utility
 *
 * Provides logging functions that automatically sanitize sensitive data.
 * Prevents accidental credential exposure in logs.
 *
 * Security Expert: Troy Hunt - Credential Exposure Prevention
 */

import winston from 'winston';

// Sensitive field patterns to redact
const SENSITIVE_PATTERNS = [
  /apikey/i,
  /api_key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /authorization/i,
  /bearer/i,
  /access_token/i,
  /refresh_token/i,
  /client_secret/i,
  /private_key/i,
  /supabase/i,
  /stripe/i
];

// Value patterns that look like secrets
const SECRET_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9-]+$/,  // OpenAI/OpenRouter style
  /^THQ[A-Za-z0-9]+$/,   // Threads token style
  /^[A-Za-z0-9+/=]{32,}$/, // Base64 encoded secrets
  /^[a-f0-9]{32,}$/i,    // Hex encoded secrets
  /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]*$/, // JWT tokens
  /^sk_live_[a-zA-Z0-9]+$/,  // Stripe live keys
  /^sk_test_[a-zA-Z0-9]+$/,  // Stripe test keys
  /^sbp_[a-zA-Z0-9]+$/       // Supabase keys
];

/**
 * Masks a sensitive string value.
 */
function maskValue(value: string): string {
  if (!value || value.length < 8) {
    return '••••••••';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Checks if a key name is sensitive.
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Checks if a value looks like a secret.
 */
function looksLikeSecret(value: string): boolean {
  if (typeof value !== 'string' || value.length < 20) {
    return false;
  }
  return SECRET_VALUE_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Recursively sanitizes an object, masking sensitive values.
 */
export function sanitizeForLogging(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[Max depth exceeded]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitive types
  if (typeof obj === 'string') {
    return looksLikeSecret(obj) ? maskValue(obj) : obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForLogging(item, depth + 1));
  }

  // Handle Error objects
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: sanitizeForLogging(obj.message, depth + 1),
      stack: obj.stack?.split('\n').slice(0, 5).join('\n') // Limit stack trace
    };
  }

  // Handle regular objects
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = typeof value === 'string' ? maskValue(value) : '••••••••';
    } else {
      sanitized[key] = sanitizeForLogging(value, depth + 1);
    }
  }

  return sanitized;
}

/**
 * Creates a safe Winston logger with automatic sanitization.
 */
export function createSafeLogger(options?: winston.LoggerOptions): winston.Logger {
  const defaultOptions: winston.LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const sanitizedMeta = Object.keys(meta).length > 0
          ? ` ${JSON.stringify(sanitizeForLogging(meta))}`
          : '';
        return `${timestamp} [${level.toUpperCase()}]: ${message}${sanitizedMeta}`;
      })
    ),
    transports: [new winston.transports.Console()]
  };

  return winston.createLogger({ ...defaultOptions, ...options });
}

/**
 * Safe logging functions that sanitize before output.
 */
export const safeLog = {
  info: (message: string, meta?: unknown) => {
    console.log(`[INFO] ${message}`, meta ? sanitizeForLogging(meta) : '');
  },

  warn: (message: string, meta?: unknown) => {
    console.warn(`[WARN] ${message}`, meta ? sanitizeForLogging(meta) : '');
  },

  error: (message: string, meta?: unknown) => {
    console.error(`[ERROR] ${message}`, meta ? sanitizeForLogging(meta) : '');
  },

  debug: (message: string, meta?: unknown) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}`, meta ? sanitizeForLogging(meta) : '');
    }
  }
};

export default safeLog;
