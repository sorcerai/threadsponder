/**
 * Upstash Redis Client Wrapper
 *
 * Serverless-compatible Redis client using HTTP (no connection pooling needed)
 * Multi-tenant safe with built-in key validation
 */

import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { globalKeys, TTL } from './redis-keys.js';

// Singleton client instance
let redisClient: Redis | null = null;

/**
 * Get or create the Upstash Redis client
 * Uses HTTP-based connection (no pooling needed for serverless)
 */
export const getRedisClient = (): Redis => {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing Upstash Redis configuration. ' +
      'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables.'
    );
  }

  redisClient = new Redis({
    url,
    token,
    // Auto-retry on transient failures
    retry: {
      retries: 3,
      backoff: (retryCount: number) => Math.min(1000 * Math.pow(2, retryCount), 10000),
    },
  });

  return redisClient;
};

/**
 * Rate Limiter Factory
 * Creates tenant-aware rate limiters for different endpoints
 */
export const createUpstashRateLimiter = (
  type: 'api' | 'auth' | 'webhook',
  options?: { requests?: number; window?: string }
) => {
  const redis = getRedisClient();

  // Default rate limits by type
  const defaults = {
    api: { requests: 100, window: '1m' },      // 100 requests per minute
    auth: { requests: 10, window: '1m' },      // 10 auth attempts per minute
    webhook: { requests: 50, window: '1m' },   // 50 webhooks per minute
  };

  const config = { ...defaults[type], ...options };

  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.requests, config.window as `${number} s` | `${number} m` | `${number} h` | `${number} d`),
    analytics: true,
    prefix: `rate:${type}`,
  });
};

/**
 * OAuth State Management
 * For CSRF protection in OAuth flows
 */
export const oauthState = {
  /**
   * Store OAuth state with org context
   */
  async set(token: string, orgId: string): Promise<void> {
    const redis = getRedisClient();
    const key = globalKeys.oauthState(token);

    await redis.set(key, JSON.stringify({ orgId, createdAt: Date.now() }), {
      ex: TTL.OAUTH_STATE,
    });
  },

  /**
   * Validate and consume OAuth state
   * Returns orgId if valid, null if invalid/expired
   */
  async validate(token: string): Promise<string | null> {
    const redis = getRedisClient();
    const key = globalKeys.oauthState(token);

    const data = await redis.get<{ orgId: string; createdAt: number }>(key);
    if (!data) return null;

    // Delete after validation (one-time use)
    await redis.del(key);

    return data.orgId;
  },
};

/**
 * Distributed Lock for Job Deduplication
 */
export const jobLock = {
  /**
   * Acquire a lock for a job
   * Returns true if lock acquired, false if already locked
   */
  async acquire(jobId: string, ttlSeconds = TTL.JOB_LOCK): Promise<boolean> {
    const redis = getRedisClient();
    const key = globalKeys.jobLock(jobId);

    // NX = only set if not exists
    const result = await redis.set(key, Date.now().toString(), {
      ex: ttlSeconds,
      nx: true,
    });

    return result === 'OK';
  },

  /**
   * Release a job lock
   */
  async release(jobId: string): Promise<void> {
    const redis = getRedisClient();
    const key = globalKeys.jobLock(jobId);
    await redis.del(key);
  },

  /**
   * Check if a job is locked
   */
  async isLocked(jobId: string): Promise<boolean> {
    const redis = getRedisClient();
    const key = globalKeys.jobLock(jobId);
    const exists = await redis.exists(key);
    return exists === 1;
  },
};

/**
 * Tenant Cache Operations with built-in TTL
 */
export const tenantCache = {
  /**
   * Get cached value for a tenant
   */
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedisClient();
    return redis.get<T>(key);
  },

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const redis = getRedisClient();
    await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  },

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(key);
  },

  /**
   * Get multiple keys at once
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const redis = getRedisClient();
    return redis.mget<T[]>(...keys);
  },
};

/**
 * Tenant Set Operations (for friends list, blocked list, etc.)
 */
export const tenantSet = {
  async add(key: string, ...members: string[]): Promise<number> {
    const redis = getRedisClient();
    return redis.sadd(key, members);
  },

  async remove(key: string, ...members: string[]): Promise<number> {
    const redis = getRedisClient();
    return redis.srem(key, members);
  },

  async members(key: string): Promise<string[]> {
    const redis = getRedisClient();
    return redis.smembers(key);
  },

  async isMember(key: string, member: string): Promise<boolean> {
    const redis = getRedisClient();
    const result = await redis.sismember(key, member);
    return result === 1;
  },
};

/**
 * Tenant Hash Operations (for focus URLs, post metadata, etc.)
 */
export const tenantHash = {
  async get(key: string, field: string): Promise<string | null> {
    const redis = getRedisClient();
    return redis.hget(key, field);
  },

  async getAll(key: string): Promise<Record<string, string>> {
    const redis = getRedisClient();
    const result = await redis.hgetall<Record<string, string>>(key);
    return result || {};
  },

  async set(key: string, field: string, value: string): Promise<void> {
    const redis = getRedisClient();
    await redis.hset(key, { [field]: value });
  },

  async setMultiple(key: string, data: Record<string, string>): Promise<void> {
    const redis = getRedisClient();
    await redis.hset(key, data);
  },

  async del(key: string, ...fields: string[]): Promise<number> {
    const redis = getRedisClient();
    return redis.hdel(key, ...fields);
  },
};

/**
 * Tenant Counter Operations (for stats, limits, etc.)
 */
export const tenantCounter = {
  async incr(key: string): Promise<number> {
    const redis = getRedisClient();
    return redis.incr(key);
  },

  async incrBy(key: string, amount: number): Promise<number> {
    const redis = getRedisClient();
    return redis.incrby(key, amount);
  },

  async get(key: string): Promise<number> {
    const redis = getRedisClient();
    const val = await redis.get<string>(key);
    return val ? parseInt(val, 10) : 0;
  },

  async set(key: string, value: number, ttlSeconds?: number): Promise<void> {
    const redis = getRedisClient();
    if (ttlSeconds) {
      await redis.set(key, value.toString(), { ex: ttlSeconds });
    } else {
      await redis.set(key, value.toString());
    }
  },
};

/**
 * Scan keys matching a pattern (for tenant cleanup, etc.)
 * Use with caution in production - prefer specific key lookups
 */
export const scanKeys = async (pattern: string, count = 100): Promise<string[]> => {
  const redis = getRedisClient();
  const keys: string[] = [];
  let cursor: number = 0;

  do {
    const [nextCursor, matchedKeys] = await redis.scan(cursor, {
      match: pattern,
      count,
    });
    cursor = Number(nextCursor);
    keys.push(...matchedKeys);
  } while (cursor !== 0);

  return keys;
};

export type { Redis };
