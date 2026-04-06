import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';

const DB_PATH = '/tmp/threadsponder-test.db';

beforeEach(() => {
  process.env.SQLITE_DB_PATH = DB_PATH;
});

afterEach(async () => {
  const { _resetDb } = await import('../sqlite.js');
  _resetDb();
  vi.resetModules();
  try { fs.unlinkSync(DB_PATH); } catch { /* already gone */ }
});

describe('SQLite client', () => {
  test('given a DB path, should open and initialise schema without throwing', async () => {
    const { getDb } = await import('../sqlite.js');
    const db = getDb();
    expect(db.open).toBe(true);
  });

  test('given schema init, accounts table should exist', async () => {
    const { getDb } = await import('../sqlite.js');
    const db = getDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get();
    expect(row).toBeDefined();
  });

  test('given schema init, reply_history table should exist with correct columns', async () => {
    const { getDb } = await import('../sqlite.js');
    const db = getDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_history'").get();
    expect(row).toBeDefined();
  });
});
