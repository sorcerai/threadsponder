import { z } from 'zod';

// Simple console logger (no external dependency)
const logger = {
  info: (msg: string, data?: unknown) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg: string, data?: unknown) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg: string, data?: unknown) => console.warn(`[WARN] ${msg}`, data || '')
};

// Schema for Threads post
const ThreadsPostSchema = z.object({
  text: z.string().max(500),
  mediaType: z.enum(['TEXT', 'IMAGE', 'VIDEO']).default('TEXT'),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  replyToId: z.string().optional()
});

// Schema for post metrics
const PostMetricsSchema = z.object({
  views: z.number(),
  likes: z.number(),
  replies: z.number(),
  reposts: z.number(),
  quotes: z.number(),
  shares: z.number()
});

// Error tracking for observability
export interface ThreadsError {
  timestamp: string;
  operation: string;
  error: string;
  details?: unknown;
  replyTo?: string;
  text?: string;
}

/** Untyped Threads Graph API JSON payload — narrowed at each call site. */
type ApiPayload = Record<string, unknown>;

/** Message from a caught error, whatever was thrown. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** API-level error message from a payload's `error` field. */
function apiErrorMessage(payload: ApiPayload): string {
  const err = payload.error as { message?: unknown } | undefined;
  return typeof err?.message === 'string' && err.message
    ? err.message
    : JSON.stringify(payload.error);
}

// In-memory error log (recent 50 errors)
const errorLog: ThreadsError[] = [];
const MAX_ERROR_LOG = 50;

function logError(error: ThreadsError): void {
  errorLog.unshift(error);
  if (errorLog.length > MAX_ERROR_LOG) {
    errorLog.pop();
  }
  logger.error(`[${error.operation}] ${error.error}`, error.details || {});
}

export function getRecentErrors(): ThreadsError[] {
  return [...errorLog];
}

export function clearErrors(): void {
  errorLog.length = 0;
}

/**
 * Direct Threads Graph API Client
 * Uses native fetch - no external dependencies
 */
export class ThreadsDirectClient {
  private accessToken: string;
  private userId: string;
  private readonly baseUrl = 'https://graph.threads.net/v1.0';

  constructor() {
    this.accessToken = process.env.THREADS_ACCESS_TOKEN || '';
    this.userId = process.env.THREADS_USER_ID || '';

    if (!this.accessToken || !this.userId) {
      logger.error('Missing THREADS_ACCESS_TOKEN or THREADS_USER_ID');
    }

    logger.info('ThreadsDirectClient initialized', { userId: this.userId });
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('access_token', this.accessToken);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async fetchJson(url: string, options?: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers
      }
    });
    return response.json();
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const url = this.buildUrl(`/${this.userId}`, { fields: 'id,username' });
      const data = (await this.fetchJson(url)) as ApiPayload;
      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }
      logger.info('Threads API connection successful', { username: data.username as string });
      return true;
    } catch (error: unknown) {
      logger.error('Threads API connection failed:', errorMessage(error));
      return false;
    }
  }

  /**
   * Create and publish a post or reply
   */
  async createPost(params: {
    text: string;
    mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO';
    imageUrl?: string;
    videoUrl?: string;
    replyToId?: string;
  }): Promise<{ success: boolean; postId?: string; error?: string }> {
    try {
      const validated = ThreadsPostSchema.parse(params);
      logger.info('Creating Threads post:', {
        text: validated.text.substring(0, 50) + '...',
        isReply: !!validated.replyToId
      });

      // Step 1: Create container
      const containerParams: Record<string, unknown> = {
        media_type: validated.mediaType,
        text: validated.text
      };

      if (validated.replyToId) {
        containerParams.reply_to_id = validated.replyToId;
      }

      if (validated.mediaType === 'IMAGE' && validated.imageUrl) {
        containerParams.image_url = validated.imageUrl;
      } else if (validated.mediaType === 'VIDEO' && validated.videoUrl) {
        containerParams.video_url = validated.videoUrl;
      }

      const containerUrl = this.buildUrl(`/${this.userId}/threads`, containerParams);
      const containerData = (await this.fetchJson(containerUrl, { method: 'POST' })) as ApiPayload;

      if (containerData.error) {
        throw new Error(apiErrorMessage(containerData));
      }

      const containerId = containerData.id as string | undefined;
      if (!containerId) {
        throw new Error(`Container creation failed - API returned: ${JSON.stringify(containerData)}`);
      }
      logger.info('Container created:', containerId);

      // Step 2: Publish the container
      const publishUrl = this.buildUrl(`/${this.userId}/threads_publish`, { creation_id: containerId });
      const publishData = (await this.fetchJson(publishUrl, { method: 'POST' })) as ApiPayload;

      if (publishData.error) {
        throw new Error(apiErrorMessage(publishData));
      }

      const postId = publishData.id as string | undefined;
      logger.info('Post published:', postId);

      return { success: true, postId };
    } catch (error: unknown) {
      const errorMsg = errorMessage(error);

      logError({
        timestamp: new Date().toISOString(),
        operation: params.replyToId ? 'reply' : 'post',
        error: errorMsg,
        text: params.text?.substring(0, 50),
        replyTo: params.replyToId
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Reply to a specific post
   */
  async replyToPost(postId: string, text: string): Promise<{
    success: boolean;
    replyId?: string;
    error?: string
  }> {
    const result = await this.createPost({
      text,
      mediaType: 'TEXT',
      replyToId: postId
    });
    return {
      success: result.success,
      replyId: result.postId,
      error: result.error
    };
  }

  /**
   * Get user's posts
   */
  async getUserPosts(limit: number = 10): Promise<{
    success: boolean;
    posts?: Array<{
      id: string;
      text: string;
      timestamp: string;
      mediaType: string;
      permalink?: string;
    }>;
    error?: string;
  }> {
    try {
      logger.info('Fetching user posts, limit:', limit);

      const url = this.buildUrl(`/${this.userId}/threads`, {
        fields: 'id,text,timestamp,permalink,media_type',
        limit
      });
      const data = (await this.fetchJson(url)) as ApiPayload;

      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }

      if (data.data) {
        const posts = (data.data as ApiPayload[]).map((post) => ({
          id: post.id as string,
          text: (post.text as string) || '',
          timestamp: post.timestamp as string,
          mediaType: post.media_type as string,
          permalink: post.permalink as string | undefined
        }));

        logger.info(`Fetched ${posts.length} posts`);
        return { success: true, posts };
      }

      return { success: true, posts: [] };
    } catch (error: unknown) {
      logger.error('Failed to fetch posts:', errorMessage(error));
      return { success: false, error: errorMessage(error) };
    }
  }

  /**
   * Get replies to a specific post
   */
  async getPostReplies(postId: string, limit: number = 50): Promise<{
    success: boolean;
    replies?: Array<{
      id: string;
      text: string;
      username: string;
      timestamp: string;
      permalink: string;
      mediaType: string;
      mediaUrl: string | null;
      hasReplies: boolean;
      isReplyOwnedByMe: boolean;
    }>;
    error?: string;
  }> {
    try {
      logger.info('Fetching replies for post:', postId);

      const url = this.buildUrl(`/${postId}/replies`, {
        fields: 'id,text,username,permalink,timestamp,media_type,media_url,has_replies,is_reply_owned_by_me',
        limit
      });
      const data = (await this.fetchJson(url)) as ApiPayload;

      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }

      if (data.data) {
        const replies = (data.data as ApiPayload[]).map((reply) => ({
          id: reply.id as string,
          text: (reply.text as string) || '',
          username: (reply.username as string) || 'unknown',
          timestamp: reply.timestamp as string,
          permalink: (reply.permalink as string) || '',
          mediaType: (reply.media_type as string) || 'TEXT',
          mediaUrl: (reply.media_url as string) || null,
          hasReplies: (reply.has_replies as boolean) || false,
          isReplyOwnedByMe: (reply.is_reply_owned_by_me as boolean) || false
        }));

        logger.info(`Fetched ${replies.length} replies for post ${postId}`);
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: unknown) {
      logger.error('Failed to fetch replies:', errorMessage(error));
      return { success: false, error: errorMessage(error) };
    }
  }

  /**
   * Get user's replies (posts where user replied)
   */
  async getUserReplies(limit: number = 50): Promise<{
    success: boolean;
    replies?: Array<{
      id: string;
      text: string;
      username: string;
      timestamp: string;
      permalink: string;
      rootPost: unknown;
      repliedTo: unknown;
    }>;
    error?: string;
  }> {
    try {
      logger.info('Fetching user replies, limit:', limit);

      const url = this.buildUrl(`/${this.userId}/replies`, {
        fields: 'id,text,username,permalink,timestamp,media_type,root_post,replied_to,is_reply',
        limit
      });
      const data = (await this.fetchJson(url)) as ApiPayload;

      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }

      if (data.data) {
        const replies = (data.data as ApiPayload[]).map((reply) => ({
          id: reply.id as string,
          text: (reply.text as string) || '',
          username: (reply.username as string) || 'unknown',
          timestamp: reply.timestamp as string,
          permalink: (reply.permalink as string) || '',
          rootPost: reply.root_post,
          repliedTo: reply.replied_to
        }));

        logger.info(`Fetched ${replies.length} user replies`);
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: unknown) {
      logger.error('Failed to fetch user replies:', errorMessage(error));
      return { success: false, error: errorMessage(error) };
    }
  }

  /**
   * Get post metrics/insights
   */
  async getPostMetrics(postId: string): Promise<{
    success: boolean;
    metrics?: z.infer<typeof PostMetricsSchema>;
    error?: string;
  }> {
    try {
      logger.info('Fetching metrics for post:', postId);

      const url = this.buildUrl(`/${postId}/insights`, {
        metric: 'views,likes,replies,reposts,quotes,shares'
      });
      const data = (await this.fetchJson(url)) as ApiPayload;

      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }

      if (data.data) {
        const metrics: Record<string, number> = {
          views: 0,
          likes: 0,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0
        };

        (data.data as ApiPayload[]).forEach((metric) => {
          const rawValue = (metric.values as Array<{ value?: unknown }> | undefined)?.[0]?.value;
          const value = typeof rawValue === 'number' ? rawValue : 0;
          const name = metric.name === 'thread_replies' ? 'replies' : metric.name as string;
          if (name in metrics) {
            metrics[name] = value;
          }
        });

        const validated = PostMetricsSchema.parse(metrics);
        logger.info('Metrics fetched:', validated);

        return { success: true, metrics: validated };
      }

      return { success: false, error: 'No metrics data returned' };
    } catch (error: unknown) {
      logger.error('Failed to fetch metrics:', errorMessage(error));
      return { success: false, error: errorMessage(error) };
    }
  }

  /**
   * Get a single post by ID
   */
  async getPost(postId: string): Promise<{
    success: boolean;
    post?: {
      id: string;
      text: string;
      timestamp: string;
      permalink: string;
      mediaType: string;
      username: string;
    };
    error?: string;
  }> {
    try {
      logger.info('Fetching post:', postId);

      const url = this.buildUrl(`/${postId}`, {
        fields: 'id,text,timestamp,permalink,media_type,username'
      });
      const data = (await this.fetchJson(url)) as ApiPayload;

      if (data.error) {
        throw new Error(apiErrorMessage(data));
      }

      if (data.id) {
        const post = {
          id: data.id as string,
          text: (data.text as string) || '',
          timestamp: data.timestamp as string,
          permalink: data.permalink as string,
          mediaType: data.media_type as string,
          username: data.username as string
        };

        logger.info('Post fetched:', post.id);
        return { success: true, post };
      }

      return { success: false, error: 'No post data returned' };
    } catch (error: unknown) {
      logger.error('Failed to fetch post:', errorMessage(error));
      return { success: false, error: errorMessage(error) };
    }
  }
}
