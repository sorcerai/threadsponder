import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      SQLITE_DB_PATH: ':memory:',
      CREDENTIAL_ENCRYPTION_KEY: Buffer.from('test-encryption-key-32bytes!!!!!').toString('base64'),
      DEFAULT_ORG_ID: 'test-org',
      NODE_ENV: 'test',
    },
  },
});
