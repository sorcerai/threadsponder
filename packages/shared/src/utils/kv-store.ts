/**
 * In-memory KV store with TTL.
 * Replaces Upstash Redis for single-process local use.
 * Not suitable for multi-process or distributed deployments.
 */

interface Entry<T> {
  value: T;
  expiresAt: number; // unix ms
}

class KvStore {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Set only if key does not exist. Returns true if set, false if already present. */
  setNx<T>(key: string, value: T, ttlSeconds: number): boolean {
    if (this.get(key) !== null) return false;
    this.set(key, value, ttlSeconds);
    return true;
  }

  del(key: string): void {
    this.store.delete(key);
  }

  /** Clear all entries — for test isolation only. */
  clear(): void {
    this.store.clear();
  }
}

export const kvStore = new KvStore();

const TTL_OAUTH_STATE = 300;  // 5 minutes
const TTL_JOB_LOCK = 600;     // 10 minutes

/** OAuth CSRF state — 5 minute TTL, one-time use */
export const oauthState = {
  set(token: string, orgId: string): void {
    kvStore.set(`oauth:state:${token}`, orgId, TTL_OAUTH_STATE);
  },
  validate(token: string): string | null {
    const key = `oauth:state:${token}`;
    const orgId = kvStore.get<string>(key);
    if (orgId) kvStore.del(key); // consume — one-time use
    return orgId;
  },
};

/** Job deduplication lock — 10 minute TTL */
export const jobLock = {
  acquire(jobId: string, ttlSeconds = TTL_JOB_LOCK): boolean {
    return kvStore.setNx(`lock:job:${jobId}`, '1', ttlSeconds);
  },
  release(jobId: string): void {
    kvStore.del(`lock:job:${jobId}`);
  },
  isLocked(jobId: string): boolean {
    return kvStore.get(`lock:job:${jobId}`) !== null;
  },
};
