import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';

// Schema for Threads post
const ThreadsPostSchema = z.object({
  text: z.string().max(500),
  mediaType: z.enum(['TEXT', 'IMAGE', 'VIDEO']).default('TEXT'),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  replyToId: z.string().optional(),
});

/**
 * Multi-tenant Threads Graph API Client
 * Accepts credentials via constructor (not env vars)
 */
export class ThreadsClient {
  private accessToken: string;
  private userId: string;
  private api: AxiosInstance;
  private readonly baseUrl = 'https://graph.threads.net/v1.0';

  constructor(config: { accessToken: string; userId: string }) {
    this.accessToken = config.accessToken;
    this.userId = config.userId;

    this.api = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth to all requests
    this.api.interceptors.request.use((axiosConfig) => {
      const separator = axiosConfig.url?.includes('?') ? '&' : '?';
      axiosConfig.url = `${axiosConfig.url}${separator}access_token=${this.accessToken}`;
      return axiosConfig;
    });
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; username?: string; error?: string }> {
    try {
      const response = await this.api.get(`/${this.userId}?fields=id,username`);
      return { success: true, username: response.data.username };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
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

      // Step 1: Create container
      const containerParams: Record<string, unknown> = {
        media_type: validated.mediaType,
        text: validated.text,
      };

      if (validated.replyToId) {
        containerParams.reply_to_id = validated.replyToId;
      }

      if (validated.mediaType === 'IMAGE' && validated.imageUrl) {
        containerParams.image_url = validated.imageUrl;
      } else if (validated.mediaType === 'VIDEO' && validated.videoUrl) {
        containerParams.video_url = validated.videoUrl;
      }

      const containerResponse = await this.api.post(`/${this.userId}/threads`, null, {
        params: containerParams,
      });

      const containerId = containerResponse.data?.id;
      if (!containerId) {
        throw new Error(`Container creation failed: ${JSON.stringify(containerResponse.data)}`);
      }

      // Step 2: Publish the container
      const publishResponse = await this.api.post(`/${this.userId}/threads_publish`, null, {
        params: { creation_id: containerId },
      });

      return { success: true, postId: publishResponse.data.id };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Reply to a specific post
   */
  async replyToPost(
    postId: string,
    text: string
  ): Promise<{ success: boolean; replyId?: string; error?: string }> {
    const result = await this.createPost({
      text,
      mediaType: 'TEXT',
      replyToId: postId,
    });
    return {
      success: result.success,
      replyId: result.postId,
      error: result.error,
    };
  }

  /**
   * Get details for a specific post by ID (including permalink)
   */
  async getPostDetails(postId: string): Promise<{
    success: boolean;
    post?: {
      id: string;
      text: string;
      timestamp: string;
      mediaType: string;
      permalink: string;
    };
    error?: string;
  }> {
    try {
      const response = await this.api.get(`/${postId}`, {
        params: {
          fields: 'id,text,timestamp,permalink,media_type,shortcode',
        },
      });

      if (response.data) {
        return {
          success: true,
          post: {
            id: response.data.id,
            text: response.data.text || '',
            timestamp: response.data.timestamp,
            mediaType: response.data.media_type,
            permalink: response.data.permalink,
          },
        };
      }

      return { success: false, error: 'No data returned' };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get user's posts
   */
  async getUserPosts(limit = 10): Promise<{
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
      const response = await this.api.get(`/${this.userId}/threads`, {
        params: {
          fields: 'id,text,timestamp,permalink,media_type',
          limit,
        },
      });

      if (response.data?.data) {
        const posts = response.data.data.map((post: Record<string, unknown>) => ({
          id: post.id as string,
          text: (post.text as string) || '',
          timestamp: post.timestamp as string,
          mediaType: post.media_type as string,
          permalink: post.permalink as string | undefined,
        }));
        return { success: true, posts };
      }

      return { success: true, posts: [] };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get replies to a specific post
   */
  async getPostReplies(postId: string, limit = 50): Promise<{
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
      const response = await this.api.get(`/${postId}/replies`, {
        params: {
          fields:
            'id,text,username,permalink,timestamp,media_type,media_url,has_replies,is_reply_owned_by_me',
          limit,
        },
      });

      if (response.data?.data) {
        const replies = response.data.data.map((reply: Record<string, unknown>) => ({
          id: reply.id as string,
          text: (reply.text as string) || '',
          username: (reply.username as string) || 'unknown',
          timestamp: reply.timestamp as string,
          permalink: (reply.permalink as string) || '',
          mediaType: (reply.media_type as string) || 'TEXT',
          mediaUrl: (reply.media_url as string) || null,
          hasReplies: (reply.has_replies as boolean) || false,
          isReplyOwnedByMe: (reply.is_reply_owned_by_me as boolean) || false,
        }));
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get user's replies
   */
  async getUserReplies(limit = 50): Promise<{
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
      const response = await this.api.get(`/${this.userId}/replies`, {
        params: {
          fields: 'id,text,username,permalink,timestamp,media_type,root_post,replied_to,is_reply',
          limit,
        },
      });

      if (response.data?.data) {
        const replies = response.data.data.map((reply: Record<string, unknown>) => ({
          id: reply.id as string,
          text: (reply.text as string) || '',
          username: (reply.username as string) || 'unknown',
          timestamp: reply.timestamp as string,
          permalink: (reply.permalink as string) || '',
          rootPost: reply.root_post,
          repliedTo: reply.replied_to,
        }));
        return { success: true, replies };
      }

      return { success: true, replies: [] };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Get post metrics/insights from Threads API
   */
  async getPostMetrics(postId: string): Promise<{
    success: boolean;
    metrics?: {
      views: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      shares: number;
    };
    error?: string;
  }> {
    try {
      const response = await this.api.get(`/${postId}/insights`, {
        params: {
          metric: 'views,likes,replies,reposts,quotes,shares',
        },
      });

      if (response.data?.data) {
        const metrics: Record<string, number> = {
          views: 0,
          likes: 0,
          replies: 0,
          reposts: 0,
          quotes: 0,
          shares: 0,
        };

        response.data.data.forEach((metric: Record<string, unknown>) => {
          const values = metric.values as Array<{ value: number }> | undefined;
          const value = values?.[0]?.value || 0;
          // API returns 'thread_replies' but we normalize to 'replies'
          const name = metric.name === 'thread_replies' ? 'replies' : (metric.name as string);
          if (name in metrics) {
            metrics[name] = value;
          }
        });

        return { success: true, metrics: metrics as {
          views: number;
          likes: number;
          replies: number;
          reposts: number;
          quotes: number;
          shares: number;
        }};
      }

      return { success: false, error: 'No metrics data returned' };
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const errorMsg = axiosError.response?.data?.error?.message || axiosError.message || 'Unknown error';
      return { success: false, error: errorMsg };
    }
  }
}
