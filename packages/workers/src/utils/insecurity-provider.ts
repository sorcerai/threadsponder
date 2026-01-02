/**
 * Insecurity Provider - "Loser Dossier" System
 *
 * Tracks desperation metrics instead of opinions.
 * The goal is asymmetric warfare: high effort from them, zero effort from us.
 *
 * 4 Desperation Metrics:
 * 1. Latency (speed) - "Jobless" check: replied in < 60s
 * 2. Volume (chars) - "Yapper" check: wrote > 200 chars
 * 3. Double-texting - "Desperate" check: replied while waiting for us
 * 4. Frequency - "Fan" check: 5+ total replies
 *
 * Attack priority: DESPERATE > JOBLESS > YAPPER > FAN > NORMIE
 *
 * Ported from eliza-threads with Supabase multi-tenant support
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from './shared-logger.js';

// Thresholds for desperation detection
const THRESHOLDS = {
  JOBLESS_MS: 60 * 1000,     // < 60 seconds = jobless
  YAPPER_CHARS: 200,          // > 200 chars = yapper
  FAN_REPLIES: 5,             // 5+ replies = fan
  WAITING_HOURS: 24,          // 24 hours waiting window
};

export type Archetype = 'DESPERATE' | 'JOBLESS' | 'YAPPER' | 'FAN' | 'NORMIE';

export interface AttackVector {
  archetype: Archetype;
  data: string;
  prompt: string;
}

export interface DossierStats {
  lastLatencyMs: number;
  lastCharCount: number;
  totalReplies: number;
  isDoubleTexting: boolean;
  archetype: Archetype;
}

interface UserDossierRow {
  id: string;
  account_id: string;
  threads_user_id: string;
  last_latency_ms: number;
  last_char_count: number;
  total_replies: number;
  is_double_texting: boolean;
  is_waiting: boolean;
  waiting_since: string | null;
  archetype: Archetype;
  first_seen: string;
  last_seen: string;
}

export class InsecurityProvider {
  private supabase: SupabaseClient;
  private accountId: string;

  constructor(supabaseUrl: string, supabaseKey: string, accountId: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.accountId = accountId;
    logger.info(`InsecurityProvider initialized for account ${accountId}`);
  }

  /**
   * Calculate archetype from stats
   */
  private calculateArchetype(stats: {
    lastLatencyMs: number;
    lastCharCount: number;
    totalReplies: number;
    isDoubleTexting: boolean;
  }): Archetype {
    // PRIORITY 1: Double Texting (Maximum Desperation)
    if (stats.isDoubleTexting) return 'DESPERATE';

    // PRIORITY 2: Speed (The "Jobless" Check)
    if (stats.lastLatencyMs > 0 && stats.lastLatencyMs < THRESHOLDS.JOBLESS_MS) return 'JOBLESS';

    // PRIORITY 3: Volume (The "Yapper" Check)
    if (stats.lastCharCount > THRESHOLDS.YAPPER_CHARS) return 'YAPPER';

    // PRIORITY 4: Frequency (The "Fan" Check)
    if (stats.totalReplies >= THRESHOLDS.FAN_REPLIES) return 'FAN';

    // PRIORITY 5: No special weakness
    return 'NORMIE';
  }

  /**
   * LOG BEHAVIOR (Run on every incoming reply)
   * Builds the dossier of their pathetic behaviors
   */
  async trackBehavior(
    userId: string,
    text: string,
    latencyMs: number
  ): Promise<void> {
    // Check if they're double-texting BEFORE updating
    const { data: existing } = await this.supabase
      .from('user_dossiers')
      .select('is_waiting, total_replies')
      .eq('account_id', this.accountId)
      .eq('threads_user_id', userId)
      .single();

    const isDoubleTexting = existing?.is_waiting === true;
    const totalReplies = (existing?.total_replies || 0) + 1;
    const charCount = text.length;

    const newStats = {
      lastLatencyMs: latencyMs,
      lastCharCount: charCount,
      totalReplies,
      isDoubleTexting,
    };

    const archetype = this.calculateArchetype(newStats);

    // Upsert the dossier
    const { error } = await this.supabase
      .from('user_dossiers')
      .upsert({
        account_id: this.accountId,
        threads_user_id: userId,
        last_latency_ms: latencyMs,
        last_char_count: charCount,
        total_replies: totalReplies,
        is_double_texting: isDoubleTexting,
        is_waiting: true,  // Set the trap: they replied, now waiting for us
        waiting_since: new Date().toISOString(),
        archetype,
        last_seen: new Date().toISOString(),
      }, {
        onConflict: 'account_id,threads_user_id',
      });

    if (error) {
      logger.error(`Failed to track behavior for @${userId}:`, error);
      return;
    }

    logger.info(
      `Dossier updated: @${userId} - ` +
      `latency=${(latencyMs/1000).toFixed(1)}s, ` +
      `chars=${charCount}, ` +
      `doubleText=${isDoubleTexting}, ` +
      `archetype=${archetype}`
    );
  }

  /**
   * GET THE KNIFE (Select the best attack angle)
   * Returns the archetype and attack instructions
   */
  async getAttackVector(userId: string): Promise<AttackVector> {
    const { data } = await this.supabase
      .from('user_dossiers')
      .select('*')
      .eq('account_id', this.accountId)
      .eq('threads_user_id', userId)
      .single();

    if (!data) {
      return {
        archetype: 'NORMIE',
        data: 'no dossier',
        prompt: 'INSTRUCTION: Standard dismissive ragebait. Attack the content.',
      };
    }

    const row = data as UserDossierRow;

    // PRIORITY 1: Double Texting (Maximum Desperation)
    if (row.is_double_texting) {
      return {
        archetype: 'DESPERATE',
        data: 'double-texting',
        prompt: `
TARGET WEAKNESS: They are double-texting a bot.
INSTRUCTION: Ignore their text. Mock their desperation.
EXAMPLES: "double texting? embarrassing", "fighting for my attention?", "u mad?"`,
      };
    }

    // PRIORITY 2: Speed (The "Jobless" Check)
    if (row.last_latency_ms > 0 && row.last_latency_ms < THRESHOLDS.JOBLESS_MS) {
      const seconds = (row.last_latency_ms / 1000).toFixed(0);
      return {
        archetype: 'JOBLESS',
        data: `${seconds}s`,
        prompt: `
TARGET WEAKNESS: They replied in ${seconds} seconds. Terminally online.
INSTRUCTION: Tell them to get a job or turn off notifications.
EXAMPLES: "replying in ${seconds}s? get a job", "notifications on? sad", "touch grass"`,
      };
    }

    // PRIORITY 3: Volume (The "Yapper" Check)
    if (row.last_char_count > THRESHOLDS.YAPPER_CHARS) {
      return {
        archetype: 'YAPPER',
        data: `${row.last_char_count} chars`,
        prompt: `
TARGET WEAKNESS: They wrote an essay (${row.last_char_count} characters).
INSTRUCTION: Dismiss the effort. Refuse to read it.
EXAMPLES: "i ain't reading all that", "happy for u or sorry that happened", "write a book maybe"`,
      };
    }

    // PRIORITY 4: Frequency (The "Fan" Check)
    if (row.total_replies >= THRESHOLDS.FAN_REPLIES) {
      return {
        archetype: 'FAN',
        data: `${row.total_replies} replies`,
        prompt: `
TARGET WEAKNESS: They are obsessed (${row.total_replies} total replies).
INSTRUCTION: Call them a fan. Act famous.
EXAMPLES: "sign an autograph?", "fan behavior", "rent free"`,
      };
    }

    // PRIORITY 5: No special weakness detected
    return {
      archetype: 'NORMIE',
      data: 'average',
      prompt: 'INSTRUCTION: Standard dismissive ragebait. Attack the content.',
    };
  }

  /**
   * RESET TRAP (Call when YOU reply)
   * Clears the double-text detection state
   */
  async resetInteraction(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_dossiers')
      .update({
        is_waiting: false,
        waiting_since: null,
        is_double_texting: false,
      })
      .eq('account_id', this.accountId)
      .eq('threads_user_id', userId);

    if (error) {
      logger.error(`Failed to reset interaction for @${userId}:`, error);
      return;
    }

    logger.info(`Reset waiting state for @${userId}`);
  }

  /**
   * GET DOSSIER STATS (For debugging/monitoring)
   */
  async getDossierStats(userId: string): Promise<DossierStats | null> {
    const { data } = await this.supabase
      .from('user_dossiers')
      .select('*')
      .eq('account_id', this.accountId)
      .eq('threads_user_id', userId)
      .single();

    if (!data) return null;

    const row = data as UserDossierRow;
    return {
      lastLatencyMs: row.last_latency_ms,
      lastCharCount: row.last_char_count,
      totalReplies: row.total_replies,
      isDoubleTexting: row.is_double_texting,
      archetype: row.archetype,
    };
  }

  /**
   * GET ALL DOSSIERS (For admin view)
   */
  async getAllDossiers(): Promise<Map<string, DossierStats>> {
    const { data } = await this.supabase
      .from('user_dossiers')
      .select('*')
      .eq('account_id', this.accountId)
      .order('last_seen', { ascending: false });

    const dossiers = new Map<string, DossierStats>();

    if (data) {
      for (const row of data as UserDossierRow[]) {
        dossiers.set(row.threads_user_id, {
          lastLatencyMs: row.last_latency_ms,
          lastCharCount: row.last_char_count,
          totalReplies: row.total_replies,
          isDoubleTexting: row.is_double_texting,
          archetype: row.archetype,
        });
      }
    }

    return dossiers;
  }

  /**
   * GET GLOBAL STATS
   */
  async getStats(): Promise<{
    totalUsers: number;
    archetypeCounts: Record<Archetype, number>;
  }> {
    const { data } = await this.supabase
      .from('user_dossiers')
      .select('archetype')
      .eq('account_id', this.accountId);

    const archetypeCounts: Record<Archetype, number> = {
      DESPERATE: 0,
      JOBLESS: 0,
      YAPPER: 0,
      FAN: 0,
      NORMIE: 0,
    };

    if (data) {
      for (const row of data) {
        const archetype = row.archetype as Archetype;
        archetypeCounts[archetype]++;
      }
    }

    return {
      totalUsers: data?.length || 0,
      archetypeCounts,
    };
  }

  /**
   * CLEAR DOSSIER (For testing)
   */
  async clearDossier(userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_dossiers')
      .delete()
      .eq('account_id', this.accountId)
      .eq('threads_user_id', userId);

    if (error) {
      logger.error(`Failed to clear dossier for @${userId}:`, error);
      return;
    }

    logger.info(`Cleared dossier for @${userId}`);
  }
}

// Factory function for multi-tenant usage
export function createInsecurityProvider(
  supabaseUrl: string,
  supabaseKey: string,
  accountId: string
): InsecurityProvider {
  return new InsecurityProvider(supabaseUrl, supabaseKey, accountId);
}
