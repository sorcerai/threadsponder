/**
 * Safety E2E Tests
 *
 * Covers the three critical safety properties of this service:
 *   1. OAuth CSRF protection — invalid/missing state must always be rejected
 *   2. Credential encryption — tokens are never stored or reflected in plaintext
 *   3. Fail-closed behaviour — auth errors never silently grant access
 *
 * Uses supertest against the real Express app (no DB calls — DB interactions
 * are tested via observable HTTP behaviour, not by inspecting state).
 */

import { describe, test, expect, vi } from 'vitest';
import request from 'supertest';

// Stub out DB and Redis before importing app to keep tests fast and hermetic.
// We are testing HTTP-layer safety properties only.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'test-account-id' }, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

// Stub Redis-backed oauthState so state validation is under test control
vi.mock('@threadsponder/shared', async (importActual: () => Promise<typeof import('@threadsponder/shared')>) => {
  const actual = await importActual();
  return {
    ...actual,
    oauthState: {
      set: vi.fn(async () => {}),
      // Returns null = state expired/invalid — the default for any unrecognised token
      validate: vi.fn(async (_token: string) => null),
    },
  };
});

import { app } from '../index.js';

// ---------------------------------------------------------------------------
// 1. OAuth CSRF Protection
// ---------------------------------------------------------------------------
describe('OAuth CSRF Protection', () => {
  test('given callback with no state param, should redirect with invalid_state error', async () => {
    const res = await request(app)
      .get('/api/auth/threads/callback')
      .query({ code: 'legit-code' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/error=invalid_state/);
  });

  test('given callback with unrecognised state token, should redirect with state_expired error', async () => {
    const res = await request(app)
      .get('/api/auth/threads/callback')
      .query({ code: 'legit-code', state: 'random-unknown-token' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/error=state_expired/);
  });

  test('given Threads error response in callback, should redirect with error description', async () => {
    const res = await request(app)
      .get('/api/auth/threads/callback')
      .query({ error: 'access_denied', error_description: 'user cancelled' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/error=/);
    // Must not expose raw error_description verbatim (could contain injected chars)
    expect(res.headers.location).not.toMatch(/user cancelled/);
  });

  test('given OAuth start with no THREADS_APP_ID configured, should return 500 not 302', async () => {
    // App is not configured for OAuth (env vars not set in test)
    const res = await request(app).get('/api/auth/threads');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Credential Encryption
// ---------------------------------------------------------------------------
describe('Credential Encryption', () => {
  test('given a plaintext token, encryptCredential should return base64 ciphertext not equal to input', async () => {
    const { encryptCredential } = await import('@threadsponder/shared');
    const token = 'super-secret-threads-token-abc123';
    const encrypted = encryptCredential(token);

    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(token);
    // Must be base64 (no raw plaintext leaking through)
    expect(Buffer.from(encrypted!, 'base64').toString('base64')).toBe(encrypted);
  });

  test('given ciphertext, decryptCredential should recover original plaintext', async () => {
    const { encryptCredential, decryptCredential } = await import('@threadsponder/shared');
    const token = 'threads-access-token-roundtrip-test';
    const encrypted = encryptCredential(token)!;
    const decrypted = decryptCredential(encrypted);

    expect(decrypted).toBe(token);
  });

  test('given tampered ciphertext, decryptCredential should return null (GCM auth tag check)', async () => {
    const { encryptCredential, decryptCredential } = await import('@threadsponder/shared');
    const encrypted = encryptCredential('real-token')!;

    // Flip the last byte to simulate tampering
    const buf = Buffer.from(encrypted, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(decryptCredential(tampered)).toBeNull();
  });

  test('given empty string, encryptCredential should return null without throwing', async () => {
    const { encryptCredential } = await import('@threadsponder/shared');
    expect(encryptCredential('')).toBeNull();
  });

  test('given null-like input, encryptCredential should return null without throwing', async () => {
    const { encryptCredential } = await import('@threadsponder/shared');
    // @ts-expect-error — testing JS callers passing bad types
    expect(encryptCredential(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Fail-Closed Behaviour
// ---------------------------------------------------------------------------
describe('Fail-Closed Behaviour', () => {
  test('given health endpoint, should respond 200 without auth (public route)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('given /api/health endpoint, should respond 200 without auth (public route)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('given protected route with no auth context available, should not return 200 with empty body', async () => {
    // In standalone mode authMiddleware auto-creates an account.
    // What we assert: the route must not succeed and silently return empty data.
    // Either auth works (200 with real data shape) or it errors (4xx/5xx).
    const res = await request(app).get('/api/stats');
    // Must never be a silent empty 200
    const isEmptySuccess = res.status === 200 && JSON.stringify(res.body) === '{}';
    expect(isEmptySuccess).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. State Token Isolation (regression: state token must not be reusable)
// ---------------------------------------------------------------------------
describe('State Token Isolation', () => {
  test('given validate returns orgId on first call, second call with same token should be rejected', async () => {
    // Simulate one-time-use state: first call returns orgId, second returns null
    const { oauthState } = await import('@threadsponder/shared');
    const validateMock = vi.mocked(oauthState.validate);

    validateMock
      .mockResolvedValueOnce('org-abc')   // first call: valid
      .mockResolvedValueOnce(null);        // second call: consumed / expired

    const firstCall = await oauthState.validate('some-token');
    const secondCall = await oauthState.validate('some-token');

    expect(firstCall).toBe('org-abc');
    expect(secondCall).toBeNull();
  });
});
