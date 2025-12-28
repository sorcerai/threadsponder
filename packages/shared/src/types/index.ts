// Database types
export interface Account {
  id: string;
  name: string;
  email: string;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired';
  subscription_ends_at: string | null;
  stripe_customer_id: string | null;
  created_at: string;
}

export interface ThreadsAccount {
  id: string;
  account_id: string;
  threads_user_id: string;
  threads_username: string | null;
  access_token_encrypted: string;
  token_expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface VoiceExample {
  id: string;
  account_id: string;
  text: string;
  tone: 'friendly' | 'neutral' | 'hostile';
  embedding: number[] | null;
  source: 'manual' | 'import' | 'document';
  is_active: boolean;
  created_at: string;
}

export interface VoiceSettings {
  id: string;
  account_id: string;
  formality: number;
  brevity: number;
  emoji_usage: number;
  aggression: number;
  never_say: string[];
  always_use: string[];
  signature_phrases: string[];
  response_lengths: {
    friendly: { min: number; max: number };
    neutral: { min: number; max: number };
    hostile: { min: number; max: number };
  };
}

export interface Friend {
  id: string;
  account_id: string;
  username: string;
  mode: 'banter' | 'roast';
  created_at: string;
}

export interface FocusedPost {
  id: string;
  account_id: string;
  threads_account_id: string;
  post_id: string;
  post_text: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ScheduledPost {
  id: string;
  account_id: string;
  threads_account_id: string;
  content: string;
  media_urls: string[];
  scheduled_for: string;
  status: 'pending' | 'posted' | 'failed' | 'cancelled';
  posted_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface ReplyHistory {
  id: string;
  account_id: string;
  threads_account_id: string | null;
  original_reply_id: string;
  original_username: string | null;
  original_text: string | null;
  classification: string | null;
  our_response: string | null;
  was_posted: boolean;
  posted_at: string | null;
  created_at: string;
}

// API response types
export interface ThreadsPost {
  id: string;
  text: string;
  timestamp: string;
  permalink?: string;
  mediaType: string;
  username?: string;
}

export interface ThreadsReply {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  permalink: string;
  mediaType: string;
  mediaUrl: string | null;
  hasReplies: boolean;
  isReplyOwnedByMe: boolean;
}

// Job types
export interface MonitorJobData {
  tenantId: string;
  threadsAccountId: string;
}

export interface VoiceProcessorJobData {
  accountId: string;
  documentId: string;
  storagePath: string;
}

export interface SchedulerJobData {
  scheduledPostId: string;
}
