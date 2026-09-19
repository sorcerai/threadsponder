// Database types
export interface Account {
  id: string;
  clerk_user_id: string;
  name: string;
  email: string;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired';
  subscription_ends_at: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
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
  updated_at: string;
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
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ClassificationType = 'hostile' | 'friendly' | 'neutral';

export interface FocusedPost {
  id: string;
  account_id: string;
  threads_account_id: string;
  threads_post_id: string;
  post_text: string | null;
  permalink_com: string | null;
  permalink_net: string | null;
  shortcode: string | null;
  target_classifications: ClassificationType[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
  updated_at: string;
}

export interface ReplyHistory {
  id: string;
  account_id: string;
  threads_account_id: string | null;
  original_reply_id: string;
  original_username: string | null;
  original_text: string | null;
  parent_post_id: string | null;
  classification: 'friendly' | 'neutral' | 'hostile' | 'skip' | null;
  classification_confidence: number | null;
  our_response: string | null;
  our_response_id: string | null;
  was_posted: boolean;
  posted_at: string | null;
  skip_reason: string | null;
  processing_time_ms: number | null;
  model_used: string | null;
  created_at: string;
}

export interface VoiceDocument {
  id: string;
  account_id: string;
  filename: string;
  storage_path: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks_processed: number;
  examples_created: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
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
