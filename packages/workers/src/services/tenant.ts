/**
 * Tenant Service
 *
 * Loads tenant configuration from Supabase:
 * - Account details
 * - Threads credentials (decrypted)
 * - Voice settings and examples
 * - Friends list
 * - Focused posts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
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

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || '';

/**
 * Decrypt an encrypted token
 */
function decrypt(encrypted: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  }

  const [ivHex, encryptedHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
  const key = Buffer.from(ENCRYPTION_KEY, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt a token for storage
 */
export function encrypt(plaintext: string): string {
  if (!ENCRYPTION_KEY) {
    throw new Error('TOKEN_ENCRYPTION_KEY not configured');
  }

  const key = Buffer.from(ENCRYPTION_KEY, 'base64');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export class TenantService {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Get tenant config by account ID
   */
  async getTenantConfig(accountId: string): Promise<TenantConfig | null> {
    // Fetch account
    const { data: account, error: accountError } = await this.supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      console.error('Failed to load account:', accountError);
      return null;
    }

    // Fetch threads accounts
    const { data: threadsAccounts } = await this.supabase
      .from('threads_accounts')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true);

    // Fetch voice settings
    const { data: voiceSettings } = await this.supabase
      .from('voice_settings')
      .select('*')
      .eq('account_id', accountId)
      .single();

    // Fetch friends
    const { data: friends } = await this.supabase
      .from('friends')
      .select('*')
      .eq('account_id', accountId);

    return {
      account: account as Account,
      threadsAccounts: (threadsAccounts || []) as ThreadsAccount[],
      voiceSettings: voiceSettings as VoiceSettings | null,
      friends: (friends || []) as Friend[],
    };
  }

  /**
   * Get decrypted Threads credentials for a specific account
   */
  async getThreadsCredentials(
    threadsAccountId: string
  ): Promise<ThreadsCredentials | null> {
    const { data, error } = await this.supabase
      .from('threads_accounts')
      .select('threads_user_id, threads_username, access_token_encrypted')
      .eq('id', threadsAccountId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      console.error('Failed to load threads credentials:', error);
      return null;
    }

    try {
      const accessToken = decrypt(data.access_token_encrypted);
      return {
        accessToken,
        userId: data.threads_user_id,
        username: data.threads_username,
      };
    } catch (err) {
      console.error('Failed to decrypt access token:', err);
      return null;
    }
  }

  /**
   * Get voice examples for a tenant, optionally filtered by tone
   */
  async getVoiceExamples(
    accountId: string,
    tone?: 'friendly' | 'neutral' | 'hostile',
    limit: number = 20
  ): Promise<VoiceExample[]> {
    let query = this.supabase
      .from('voice_examples')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .limit(limit);

    if (tone) {
      query = query.eq('tone', tone);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to load voice examples:', error);
      return [];
    }

    return (data || []) as VoiceExample[];
  }

  /**
   * Search voice examples by embedding similarity (requires pgvector function)
   */
  async searchVoiceExamples(
    accountId: string,
    queryEmbedding: number[],
    tone: 'friendly' | 'neutral' | 'hostile',
    limit: number = 5
  ): Promise<VoiceExample[]> {
    const { data, error } = await this.supabase.rpc('search_voice_examples', {
      p_account_id: accountId,
      p_embedding: queryEmbedding,
      p_tone: tone,
      p_limit: limit,
    });

    if (error) {
      console.error('Voice search failed:', error);
      return [];
    }

    return (data || []) as VoiceExample[];
  }

  /**
   * Get focused posts to monitor for a Threads account
   */
  async getFocusedPosts(threadsAccountId: string): Promise<FocusedPost[]> {
    const { data, error } = await this.supabase
      .from('focused_posts')
      .select('*')
      .eq('threads_account_id', threadsAccountId)
      .eq('is_active', true);

    if (error) {
      console.error('Failed to load focused posts:', error);
      return [];
    }

    return (data || []) as FocusedPost[];
  }

  /**
   * Check if a username is in the friends list
   */
  async isFriend(accountId: string, username: string): Promise<Friend | null> {
    const { data, error } = await this.supabase
      .from('friends')
      .select('*')
      .eq('account_id', accountId)
      .ilike('username', username)
      .single();

    if (error || !data) {
      return null;
    }

    return data as Friend;
  }

  /**
   * Get all active tenants for scheduling jobs
   */
  async getActiveTenants(): Promise<
    Array<{ accountId: string; threadsAccountId: string }>
  > {
    const { data, error } = await this.supabase
      .from('threads_accounts')
      .select('id, account_id')
      .eq('is_active', true);

    if (error) {
      console.error('Failed to load active tenants:', error);
      return [];
    }

    return (data || []).map((row) => ({
      accountId: row.account_id,
      threadsAccountId: row.id,
    }));
  }

  /**
   * Check if subscription is active
   */
  async isSubscriptionActive(accountId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('accounts')
      .select('subscription_status, subscription_ends_at')
      .eq('id', accountId)
      .single();

    if (error || !data) {
      return false;
    }

    const { subscription_status, subscription_ends_at } = data;

    // Trial or active subscription
    if (subscription_status === 'active') {
      return true;
    }

    if (subscription_status === 'trial' && subscription_ends_at) {
      return new Date(subscription_ends_at) > new Date();
    }

    return false;
  }
}

// Singleton instance
let tenantService: TenantService | null = null;

export function getTenantService(): TenantService {
  if (!tenantService) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required');
    }

    tenantService = new TenantService(supabaseUrl, supabaseKey);
  }
  return tenantService;
}
