import { describe, test, expect, vi, afterEach } from 'vitest';
import { kvStore, oauthState, jobLock } from '../kv-store.js';

afterEach(() => kvStore.clear());

describe('kvStore', () => {
  test('given a set key, get should return the value', () => {
    kvStore.set('foo', 'bar', 60);
    expect(kvStore.get('foo')).toBe('bar');
  });

  test('given an expired key, get should return null', () => {
    vi.useFakeTimers();
    kvStore.set('foo', 'bar', 1); // 1 second TTL
    vi.advanceTimersByTime(1001);
    expect(kvStore.get<string>('foo')).toBeNull();
    vi.useRealTimers();
  });

  test('given del, get should return null', () => {
    kvStore.set('foo', 'bar', 60);
    kvStore.del('foo');
    expect(kvStore.get('foo')).toBeNull();
  });

  test('given setNx on existing key, should return false and not overwrite', () => {
    kvStore.set('lock', 'first', 60);
    const acquired = kvStore.setNx('lock', 'second', 60);
    expect(acquired).toBe(false);
    expect(kvStore.get<string>('lock')).toBe('first');
  });

  test('given setNx on missing key, should return true', () => {
    const acquired = kvStore.setNx('lock', 'owner', 60);
    expect(acquired).toBe(true);
    expect(kvStore.get<string>('lock')).toBe('owner');
  });
});

describe('oauthState', () => {
  test('given set then validate, should return orgId', () => {
    oauthState.set('tok-abc', 'org-123');
    expect(oauthState.validate('tok-abc')).toBe('org-123');
  });

  test('given validate, token should be consumed (one-time use)', () => {
    oauthState.set('tok-xyz', 'org-456');
    oauthState.validate('tok-xyz');
    expect(oauthState.validate('tok-xyz')).toBeNull();
  });

  test('given unknown token, validate should return null', () => {
    expect(oauthState.validate('not-a-token')).toBeNull();
  });
});

describe('jobLock', () => {
  test('given acquire on free lock, should return true', () => {
    expect(jobLock.acquire('job-1')).toBe(true);
  });

  test('given acquire on held lock, should return false', () => {
    jobLock.acquire('job-2');
    expect(jobLock.acquire('job-2')).toBe(false);
  });

  test('given release, lock should be acquirable again', () => {
    jobLock.acquire('job-3');
    jobLock.release('job-3');
    expect(jobLock.acquire('job-3')).toBe(true);
  });

  test('given isLocked on free lock, should return false', () => {
    expect(jobLock.isLocked('job-99')).toBe(false);
  });

  test('given isLocked on held lock, should return true', () => {
    jobLock.acquire('job-4');
    expect(jobLock.isLocked('job-4')).toBe(true);
  });
});
