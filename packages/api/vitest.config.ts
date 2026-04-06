import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      CREDENTIAL_ENCRYPTION_KEY: Buffer.from('test-encryption-key-32bytes!!!!!').toString('base64'),
      DEFAULT_ORG_ID: 'test-org',
      NODE_ENV: 'test',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      UPSTASH_REDIS_URL: 'redis://default:test@test.upstash.io:6379',
    },
  },
});
