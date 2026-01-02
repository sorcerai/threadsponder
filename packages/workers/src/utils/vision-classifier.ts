/**
 * Vision classifier using GLM-4.6v via Z.AI API
 *
 * Handles image/GIF replies on Threads:
 * 1. Downloads media from Threads media_url
 * 2. Converts to base64
 * 3. Sends to GLM-4.6v for classification
 * 4. Returns classification + image description for response generation
 *
 * Ported from eliza-threads for threadsponder multi-tenant support
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { logger } from './shared-logger.js';

const Z_AI_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const Z_AI_KEY = process.env.Z_AI_API_KEY || '';
const VISION_MODEL = 'glm-4.6v';

// Cache directory for downloaded images
const CACHE_DIR = '/tmp/threadsponder-image-cache';

export interface VisionClassificationResult {
  classification: 'friendly' | 'neutral' | 'hostile';
  confidence: number;
  reasoning: string;
  imageDescription: string; // For context in response generation
}

export interface VisionClassifyInput {
  mediaUrl: string;
  textContent: string;
  originalPost: string;
  username: string;
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Download image from URL and cache it
 * Returns path to cached file
 */
async function downloadImage(url: string): Promise<string | null> {
  try {
    ensureCacheDir();

    // Create hash of URL for filename
    const hash = createHash('md5').update(url).digest('hex');
    const ext = url.includes('.gif') ? 'gif' : url.includes('.png') ? 'png' : 'jpg';
    const cachePath = join(CACHE_DIR, `${hash}.${ext}`);

    // Check if already cached
    if (existsSync(cachePath)) {
      logger.info(`Using cached image: ${cachePath}`);
      return cachePath;
    }

    // Download image
    logger.info(`Downloading image: ${url.substring(0, 80)}...`);
    const response = await fetch(url);

    if (!response.ok) {
      logger.warn(`Failed to download image: ${response.status}`);
      return null;
    }

    const buffer = await response.arrayBuffer();
    writeFileSync(cachePath, Buffer.from(buffer));

    logger.info(`Cached image: ${cachePath} (${buffer.byteLength} bytes)`);
    return cachePath;
  } catch (error) {
    logger.error('Error downloading image:', error);
    return null;
  }
}

/**
 * Convert image file to base64 data URL
 */
function imageToBase64(filePath: string): string {
  const buffer = readFileSync(filePath);
  const ext = filePath.split('.').pop()?.toLowerCase();

  let mimeType = 'image/jpeg';
  if (ext === 'png') mimeType = 'image/png';
  if (ext === 'gif') mimeType = 'image/gif';
  if (ext === 'webp') mimeType = 'image/webp';

  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

/**
 * Clean up old cached images (older than 1 hour)
 */
export function cleanupImageCache(): void {
  try {
    ensureCacheDir();
    const files = readdirSync(CACHE_DIR);
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour

    let cleaned = 0;
    for (const file of files) {
      const filePath = join(CACHE_DIR, file);
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old cached images`);
    }
  } catch (error) {
    logger.warn('Error cleaning image cache:', error);
  }
}

/**
 * Classify an image reply using GLM-4.6v
 *
 * @param input - Classification input with media URL and context
 */
export async function classifyImageReply(input: VisionClassifyInput): Promise<VisionClassificationResult | null> {
  const { mediaUrl, textContent, originalPost, username } = input;

  try {
    if (!Z_AI_KEY) {
      logger.warn('Z_AI_API_KEY not configured, skipping vision classification');
      return null;
    }

    // Download and cache the image
    const imagePath = await downloadImage(mediaUrl);
    if (!imagePath) {
      logger.warn('Could not download image for classification');
      return null;
    }

    // Convert to base64
    const imageBase64 = imageToBase64(imagePath);

    // Build the prompt
    const prompt = `Analyze this image/GIF that someone posted as a reply on social media.

ORIGINAL POST: "${originalPost.substring(0, 200)}"
REPLY TEXT (if any): "${textContent || '(no text, just the image)'}"
USERNAME: @${username}

First, describe what the image shows (meme, reaction GIF, screenshot, etc.).
Then classify the intent of posting this image as a reply:

- friendly: supportive meme, positive reaction GIF, appreciative
- neutral: informational image, neutral reaction, question
- hostile: mocking meme, attack reaction, trolling, dismissive GIF

Output ONLY valid JSON:
{"classification": "friendly"|"neutral"|"hostile", "confidence": 0.0-1.0, "reasoning": "brief explanation", "imageDescription": "what the image shows"}`;

    // Call GLM-4.6v with image
    const response = await fetch(Z_AI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Z_AI_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`GLM-4.6v API error: ${response.status} ${errorText}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };

    let content = data.choices?.[0]?.message?.content || '';
    const reasoning = data.choices?.[0]?.message?.reasoning_content || '';

    // If content is empty but reasoning exists, try to extract from reasoning
    if (!content && reasoning) {
      logger.info('GLM-4.6v response in reasoning_content, extracting...');
      content = reasoning;
    }

    // Parse JSON from response
    const cleanContent = content
      .replace(/```json\s*\n?/g, '')
      .replace(/```\s*$/g, '')
      .trim();
    const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);

        // Validate classification
        const validClassifications = ['friendly', 'neutral', 'hostile'];
        if (!validClassifications.includes(result.classification)) {
          result.classification = 'neutral';
        }

        logger.info(
          `Vision classified @${username}: ${result.classification} (${result.confidence}) - ${result.imageDescription?.substring(0, 50)}...`
        );

        return {
          classification: result.classification as 'friendly' | 'neutral' | 'hostile',
          confidence: result.confidence ?? 0.7,
          reasoning: result.reasoning ?? 'Image analysis',
          imageDescription: result.imageDescription ?? 'Unknown image content',
        };
      } catch {
        logger.warn('Failed to parse JSON from GLM-4.6v response');
        return null;
      }
    }

    logger.warn('No valid JSON in GLM-4.6v response');
    return null;
  } catch (error) {
    logger.error('Error in vision classification:', error);
    return null;
  }
}

/**
 * Check if a media type requires vision processing
 */
export function requiresVisionProcessing(mediaType: string | undefined | null): boolean {
  if (!mediaType) return false;
  const visionTypes = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'];
  return visionTypes.includes(mediaType.toUpperCase());
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { fileCount: number; totalBytes: number } {
  try {
    ensureCacheDir();
    const files = readdirSync(CACHE_DIR);

    let totalBytes = 0;
    for (const file of files) {
      const filePath = join(CACHE_DIR, file);
      const stat = statSync(filePath);
      totalBytes += stat.size;
    }

    return { fileCount: files.length, totalBytes };
  } catch {
    return { fileCount: 0, totalBytes: 0 };
  }
}
