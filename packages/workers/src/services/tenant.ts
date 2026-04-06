/**
 * Tenant Service
 *
 * Loads tenant configuration from SQLite:
 * - Account details
 * - Threads credentials (decrypted)
 * - Voice settings and examples
 * - Friends list
 * - Focused posts
 */

import { getDb, decryptCredential } from '@threadsponder/shared';
import type {
  Account,
  ThreadsAccount,
  VoiceSettings,
  VoiceExample,
  Friend,
  FocusedPost,
} from '@threadsponder/shared';

export interface TenantConfig {
  account: Account;
  threadsAccounts: ThreadsAccount[];
  voiceSettings: VoiceSettings | null;
  friends: Friend[];
}

export interface ThreadsCredentials {
  accessToken: string;
  userId: string;
  username: string | null;
}

export class TenantService {
  getTenantConfig(accountId: string): TenantConfig | null {
    const db = getDb();

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(accountId) as Account | undefined;

    if (!account) {
      console.error(`[Tenant] Account not found: ${accountId}`);
      return null;
    }

    const threadsAccounts = db
      .prepare('SELECT * FROM threads_accounts WHERE account_id = ? AND is_active = 1')
      .all(accountId) as ThreadsAccount[];

    const voiceSettings = (db
      .prepare('SELECT * FROM voice_settings WHERE account_id = ?')
      .get(accountId) ?? null) as VoiceSettings | null;

    const friends = db
      .prepare('SELECT * FROM friends WHERE account_id = ?')
      .all(accountId) as Friend[];

    return { account, threadsAccounts, voiceSettings, friends };
  }

  getThreadsCredentials(threadsAccountId: string): ThreadsCredentials | null {
    const db = getDb();

    const row = db
      .prepare(
        'SELECT threads_user_id, threads_username, access_token_encrypted FROM threads_accounts WHERE id = ? AND is_active = 1'
      )
      .get(threadsAccountId) as
      | { threads_user_id: string; threads_username: string | null; access_token_encrypted: string }
      | undefined;

    if (!row) {
      console.error(`[Tenant] Threads account not found: ${threadsAccountId}`);
      return null;
    }

    const accessToken = decryptCredential(row.access_token_encrypted);
    if (!accessToken) {
      console.error('[Tenant] Failed to decrypt access token');
      return null;
    }

    return {
      accessToken,
      userId: row.threads_user_id,
      username: row.threads_username,
    };
  }

  getVoiceExamples(
    accountId: string,
    tone?: 'friendly' | 'neutral' | 'hostile',
    limit: number = 20
  ): VoiceExample[] {
    const db = getDb();

    if (tone) {
      return db
        .prepare('SELECT * FROM voice_examples WHERE account_id = ? AND tone = ? LIMIT ?')
        .all(accountId, tone, limit) as VoiceExample[];
    }

    return db
      .prepare('SELECT * FROM voice_examples WHERE account_id = ? LIMIT ?')
      .all(accountId, limit) as VoiceExample[];
  }

  getFocusedPosts(threadsAccountId: string): FocusedPost[] {
    const db = getDb();

    return db
      .prepare('SELECT * FROM focused_posts WHERE threads_account_id = ? AND is_active = 1')
      .all(threadsAccountId) as FocusedPost[];
  }

  getActiveTenants(): Array<{ accountId: string; threadsAccountId: string }> {
    const db = getDb();

    const rows = db
      .prepare('SELECT id, account_id FROM threads_accounts WHERE is_active = 1')
      .all() as Array<{ id: string; account_id: string }>;

    return rows.map((row) => ({
      accountId: row.account_id,
      threadsAccountId: row.id,
    }));
  }

  /** Standalone mode: subscription is always active. */
  isSubscriptionActive(_accountId: string): boolean {
    return true;
  }
}

let tenantService: TenantService | null = null;

export function getTenantService(): TenantService {
  if (!tenantService) {
    tenantService = new TenantService();
  }
  return tenantService;
}
