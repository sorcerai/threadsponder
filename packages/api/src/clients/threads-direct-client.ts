import { z } from 'zod';

// Simple console logger (no external dependency)
const logger = {
  info: (msg: string, data?: any) => console.log(`[INFO] ${msg}`, data || ''),
  error: (msg: string, data?: any) => console.error(`[ERROR] ${msg}`, data || ''),
  warn: (msg: string, data?: any) => console.warn(`[WARN] ${msg}`, data || '')
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
  details?: any;
  replyTo?: string;
  text?: string;
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

  private buildUrl(path: string, params?: Record<string, any>): string {
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

  private async fetchJson(url: string, options?: RequestInit): Promise<any> {
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
      const data = await this.fetchJson(url);
      if (data.error) {
        throw new Error(data.error.message);
      }
      logger.info('Threads API connection successful', { username: data.username });
      return true;
    } catch (error: any) {
      logger.error('Threads API connection failed:', error.message);
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
      const containerParams: Record<string, any> = {
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
      const containerData = await this.fetchJson(containerUrl, { method: 'POST' });

      if (containerData.error) {
        throw new Error(containerData.error.message || JSON.stringify(containerData.error));
      }

      const containerId = containerData.id;
      if (!containerId) {
        throw new Error(`Container creation failed - API returned: ${JSON.stringify(containerData)}`);
      }
      logger.info('Container created:', containerId);

      // Step 2: Publish the container
      const publishUrl = this.buildUrl(`/${this.userId}/threads_publish`, { creation_id: containerId });
      const publishData = await this.fetchJson(publishUrl, { method: 'POST' });

      if (publishData.error) {
        throw new Error(publishData.error.message || JSON.stringify(publishData.error));
      }

      const postId = publishData.id;
      logger.info('Post published:', postId);

      return { success: true, postId };
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error';

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
      const data = await this.fetchJson(url);

      if (data.error) {
        throw new Error(data.error.message);
      }

      if (data.data) {
        const posts = data.data.map((post: any) => ({
          id: post.id,
          text: post.text || '',
          timestamp: post.timestamp,
          mediaType: post.media_type,
          permalink: post.permalink
        }));

        logger.info(`Fetched ${posts.length} posts`);
        return { success: true, posts };
      }

      return { success: true, posts: [] };
    } catch (error: any) {
      logger.error('Failed to fetch posts:', error.message);
      return { success: false, error: error.message };
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
      const data = await this.fetchJson(url);

      if (data.error) {
        throw new Error(data.error.message);
      }

      if (data.data) {
        const replies = data.data.map((reply: any) => ({
          id: reply.id,
          text: reply.text || '',
          username: reply.username || 'unknown',
          timestamp: reply.timestamp,
          permalink: reply.permalink || '',
          mediaType: reply.media_type || 'TEXT',
          mediaUrl: reply.media_url || null,
          hasReplies: reply.has_replies || false,
          isReplyOwnedByMe: reply.is_reply_owned_by_me || false
        }));

        logger.info(`Fetched ${replies.length} replies for post ${postId}`);
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: any) {
      logger.error('Failed to fetch replies:', error.message);
      return { success: false, error: error.message };
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
      rootPost: any;
      repliedTo: any;
    }>;
    error?: string;
  }> {
    try {
      logger.info('Fetching user replies, limit:', limit);

      const url = this.buildUrl(`/${this.userId}/replies`, {
        fields: 'id,text,username,permalink,timestamp,media_type,root_post,replied_to,is_reply',
        limit
      });
      const data = await this.fetchJson(url);

      if (data.error) {
        throw new Error(data.error.message);
      }

      if (data.data) {
        const replies = data.data.map((reply: any) => ({
          id: reply.id,
          text: reply.text || '',
          username: reply.username || 'unknown',
          timestamp: reply.timestamp,
          permalink: reply.permalink || '',
          rootPost: reply.root_post,
          repliedTo: reply.replied_to
        }));

        logger.info(`Fetched ${replies.length} user replies`);
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: any) {
      logger.error('Failed to fetch user replies:', error.message);
      return { success: false, error: error.message };
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
      const data = await this.fetchJson(url);

      if (data.error) {
        throw new Error(data.error.message);
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

        data.data.forEach((metric: any) => {
          const value = metric.values?.[0]?.value || 0;
          const name = metric.name === 'thread_replies' ? 'replies' : metric.name;
          if (name in metrics) {
            metrics[name] = value;
          }
        });

        const validated = PostMetricsSchema.parse(metrics);
        logger.info('Metrics fetched:', validated);

        return { success: true, metrics: validated };
      }

      return { success: false, error: 'No metrics data returned' };
    } catch (error: any) {
      logger.error('Failed to fetch metrics:', error.message);
      return { success: false, error: error.message };
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
      const data = await this.fetchJson(url);

      if (data.error) {
        throw new Error(data.error.message);
      }

      if (data.id) {
        const post = {
          id: data.id,
          text: data.text || '',
          timestamp: data.timestamp,
          permalink: data.permalink,
          mediaType: data.media_type,
          username: data.username
        };

        logger.info('Post fetched:', post.id);
        return { success: true, post };
      }

      return { success: false, error: 'No post data returned' };
    } catch (error: any) {
      logger.error('Failed to fetch post:', error.message);
      return { success: false, error: error.message };
    }
  }
}
