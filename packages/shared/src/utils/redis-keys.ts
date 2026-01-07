/**
 * Multi-Tenant Redis Key Utilities
 *
 * All Redis operations MUST use these helpers for proper tenant isolation.
 * Pattern: org:{orgId}:{feature}:{resource}:{id}
 *
 * Migration from DragonflyDB (single-tenant) to Upstash (multi-tenant)
 */

/**
 * Build a tenant-scoped Redis key
 *
 * @example
 * tenantKey(orgId, 'focus', 'urls', postId)    // org:abc123:focus:urls:post456
 * tenantKey(orgId, 'cache', 'post', postId)    // org:abc123:cache:post:post456
 * tenantKey(orgId, 'limit', 'daily', date)     // org:abc123:limit:daily:2026-01-03
 */
export const tenantKey = (orgId: string, ...parts: string[]): string => {
  if (!orgId || orgId.trim() === '') {
    throw new Error('tenantKey: orgId is required for multi-tenant isolation');
  }

  // Validate orgId format (UUID or alphanumeric)
  const orgIdPattern = /^[a-zA-Z0-9-]+$/;
  if (!orgIdPattern.test(orgId)) {
    throw new Error(`tenantKey: Invalid orgId format: ${orgId}`);
  }

  return `org:${orgId}:${parts.join(':')}`;
};

/**
 * Build a tenant-scoped key pattern for scanning
 *
 * @example
 * tenantPattern(orgId, 'focus', '*')  // org:abc123:focus:*
 * tenantPattern(orgId, 'cache', 'post', '*')  // org:abc123:cache:post:*
 */
export const tenantPattern = (orgId: string, ...parts: string[]): string => {
  if (!orgId || orgId.trim() === '') {
    throw new Error('tenantPattern: orgId is required for multi-tenant isolation');
  }
  return `org:${orgId}:${parts.join(':')}`;
};

/**
 * Extract orgId from a tenant-scoped key
 *
 * @example
 * extractOrgId('org:abc123:focus:urls:post456')  // 'abc123'
 */
export const extractOrgId = (key: string): string | null => {
  const match = key.match(/^org:([^:]+):/);
  return match ? match[1] : null;
};

/**
 * Validate that a key belongs to a specific org
 */
export const validateKeyOwnership = (key: string, orgId: string): boolean => {
  return key.startsWith(`org:${orgId}:`);
};

/**
 * Global keys (not tenant-scoped)
 * Use sparingly - only for system-wide resources
 */
export const globalKeys = {
  /**
   * OAuth CSRF state token (5min TTL)
   * Not tenant-scoped because we need to find it before we know the org
   */
  oauthState: (token: string) => `oauth:state:${token}`,

  /**
   * Global rate limit by IP (for unauthenticated requests)
   */
  rateLimitByIp: (ip: string) => `rate:api:${ip}`,

  /**
   * Auth endpoint rate limit by Clerk user ID
   */
  rateLimitByUser: (clerkUserId: string) => `rate:auth:${clerkUserId}`,

  /**
   * Distributed job lock
   */
  jobLock: (jobId: string) => `lock:job:${jobId}`,
} as const;

/**
 * Tenant-scoped key builders organized by feature
 */
export const tenantKeys = {
  // Focus/Monitoring
  focus: {
    urls: (orgId: string, postId: string) => tenantKey(orgId, 'focus', 'urls', postId),
    meta: (orgId: string, postId: string) => tenantKey(orgId, 'focus', 'meta', postId),
    active: (orgId: string) => tenantKey(orgId, 'focus', 'active'),
  },

  // Post Cache (1hr TTL)
  cache: {
    postText: (orgId: string, postId: string) => tenantKey(orgId, 'cache', 'post', postId, 'text'),
    postMetrics: (orgId: string, postId: string) => tenantKey(orgId, 'cache', 'post', postId, 'metrics'),
  },

  // Research/RAG
  rag: {
    sources: (orgId: string) => tenantKey(orgId, 'rag', 'sources'),
    chunk: (orgId: string, source: string, chunkId: string) => tenantKey(orgId, 'rag', 'chunk', source, chunkId),
  },

  // Rate Limiting
  limit: {
    cooloff: (orgId: string, userId: string) => tenantKey(orgId, 'limit', 'cooloff', userId),
    daily: (orgId: string, date: string) => tenantKey(orgId, 'limit', 'daily', date),
  },

  // Control Flags
  control: {
    paused: (orgId: string) => tenantKey(orgId, 'control', 'paused'),
    mode: (orgId: string) => tenantKey(orgId, 'control', 'mode'),
  },

  // Friends/Blocklist (two access patterns for convenience)
  social: {
    friends: (orgId: string) => tenantKey(orgId, 'friends', 'list'),
    blocked: (orgId: string) => tenantKey(orgId, 'blocked', 'list'),
  },
  // Alias for more intuitive access
  friends: {
    list: (orgId: string) => tenantKey(orgId, 'friends', 'list'),
  },
  blocked: {
    list: (orgId: string) => tenantKey(orgId, 'blocked', 'list'),
  },

  // Statistics
  stats: {
    streakCurrent: (orgId: string) => tenantKey(orgId, 'stats', 'streak', 'current'),
    streakBest: (orgId: string) => tenantKey(orgId, 'stats', 'streak', 'best'),
  },

  // Reply History Map (tracks processed replies)
  reply: {
    map: (orgId: string, replyId: string) => tenantKey(orgId, 'reply', 'map', replyId),
  },

  // Voice Examples (RAG for response generation)
  replies: {
    short: (orgId: string) => tenantKey(orgId, 'replies', 'short'),
    medium: (orgId: string) => tenantKey(orgId, 'replies', 'medium'),
    longer: (orgId: string) => tenantKey(orgId, 'replies', 'longer'),
  },
} as const;

/**
 * TTL constants (in seconds)
 */
export const TTL = {
  POST_CACHE: 3600,        // 1 hour
  COOLOFF: 3600,           // 1 hour
  DAILY_LIMIT: 90000,      // 25 hours (roll over at midnight)
  OAUTH_STATE: 300,        // 5 minutes
  JOB_LOCK: 600,           // 10 minutes
} as const;

/**
 * BullMQ Job ID builders for tenant isolation
 * Format: org:{orgId}:{jobType}:{resourceId}:{timestamp}
 */
export const jobId = {
  monitor: (orgId: string, accountId: string) =>
    `org:${orgId}:monitor:${accountId}:${Date.now()}`,
  metrics: (orgId: string, accountId: string) =>
    `org:${orgId}:metrics:${accountId}:${Date.now()}`,
  voice: (orgId: string, userId: string) =>
    `org:${orgId}:voice:${userId}:${Date.now()}`,
  eval: (orgId: string, evalId: string) =>
    `org:${orgId}:eval:${evalId}:${Date.now()}`,
};
