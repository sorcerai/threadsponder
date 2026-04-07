// Set required env vars before any module loads
process.env.SQLITE_DB_PATH = ':memory:';
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from('test-encryption-key-32-bytes-long!!').toString('base64');
process.env.DEFAULT_ORG_ID = 'test-org';
process.env.NODE_ENV = 'test';
