/**
 * LLM Provider Abstraction
 *
 * Unified interface for LLM generation with automatic fallback:
 * 1. Primary: Google Gemini SDK (direct API, fastest)
 * 2. Fallback: OpenRouter (supports Gemini, Claude, GPT models)
 *
 * Designed for serverless environments - no CLI dependencies.
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import OpenAI from 'openai';
import { logger } from './shared-logger.js';

// Environment configuration
const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Model configuration
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const OPENROUTER_MODEL = process.env.OPENROUTER_FALLBACK_MODEL || 'google/gemini-2.0-flash-exp:free';

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface GenerateResult {
  success: boolean;
  text: string;
  provider: 'gemini' | 'openrouter' | 'none';
  error?: string;
  latencyMs?: number;
}

/**
 * Gemini SDK Provider
 * Direct API calls using @google/generative-ai
 */
class GeminiProvider {
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;

  constructor() {
    if (GOOGLE_AI_API_KEY) {
      this.client = new GoogleGenerativeAI(GOOGLE_AI_API_KEY);
      this.model = this.client.getGenerativeModel({ model: GEMINI_MODEL });
    }
  }

  isAvailable(): boolean {
    return !!this.client && !!this.model;
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    if (!this.model) {
      return {
        success: false,
        text: '',
        provider: 'gemini',
        error: 'Gemini API key not configured',
      };
    }

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options.temperature ?? 0.9,
            maxOutputTokens: options.maxTokens ?? 256,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timeout')), options.timeout ?? 30000)
        ),
      ]);

      const text = result.response.text().trim();
      const latencyMs = Date.now() - startTime;

      if (!text) {
        return {
          success: false,
          text: '',
          provider: 'gemini',
          error: 'Empty response from Gemini',
          latencyMs,
        };
      }

      return {
        success: true,
        text,
        provider: 'gemini',
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.warn(`Gemini generation failed (${latencyMs}ms): ${errorMessage}`);

      return {
        success: false,
        text: '',
        provider: 'gemini',
        error: errorMessage,
        latencyMs,
      };
    }
  }
}

/**
 * OpenRouter Provider (OpenAI-compatible)
 * Fallback provider supporting multiple models
 */
class OpenRouterProvider {
  private client: OpenAI | null = null;

  constructor() {
    if (OPENROUTER_API_KEY) {
      this.client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: OPENROUTER_API_KEY,
        defaultHeaders: {
          'HTTP-Referer': process.env.APP_URL || 'https://threadsponder.com',
          'X-Title': 'Threadsponder',
        },
      });
    }
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async generate(
    prompt: string,
    options: GenerateOptions = {},
    model?: string
  ): Promise<GenerateResult> {
    if (!this.client) {
      return {
        success: false,
        text: '',
        provider: 'openrouter',
        error: 'OpenRouter API key not configured',
      };
    }

    const startTime = Date.now();
    const useModel = model || OPENROUTER_MODEL;

    try {
      const completion = await Promise.race([
        this.client.chat.completions.create({
          model: useModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temperature ?? 0.9,
          max_tokens: options.maxTokens ?? 256,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('OpenRouter timeout')), options.timeout ?? 30000)
        ),
      ]);

      const text = completion.choices[0]?.message?.content?.trim() || '';
      const latencyMs = Date.now() - startTime;

      if (!text) {
        return {
          success: false,
          text: '',
          provider: 'openrouter',
          error: 'Empty response from OpenRouter',
          latencyMs,
        };
      }

      return {
        success: true,
        text,
        provider: 'openrouter',
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.warn(`OpenRouter generation failed (${latencyMs}ms): ${errorMessage}`);

      return {
        success: false,
        text: '',
        provider: 'openrouter',
        error: errorMessage,
        latencyMs,
      };
    }
  }
}

// Singleton instances
let geminiProvider: GeminiProvider | null = null;
let openRouterProvider: OpenRouterProvider | null = null;

function getGeminiProvider(): GeminiProvider {
  if (!geminiProvider) {
    geminiProvider = new GeminiProvider();
  }
  return geminiProvider;
}

function getOpenRouterProvider(): OpenRouterProvider {
  if (!openRouterProvider) {
    openRouterProvider = new OpenRouterProvider();
  }
  return openRouterProvider;
}

/**
 * Generate text with automatic fallback
 *
 * Tries Gemini SDK first (faster, direct API)
 * Falls back to OpenRouter on failure (rate limit, timeout, error)
 *
 * @param prompt - The prompt to send to the LLM
 * @param options - Generation options (temperature, maxTokens, timeout)
 * @returns GenerateResult with text, provider used, and timing info
 */
export async function generateWithFallback(
  prompt: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const gemini = getGeminiProvider();
  const openRouter = getOpenRouterProvider();

  // Try Gemini first (primary)
  if (gemini.isAvailable()) {
    const result = await gemini.generate(prompt, options);
    if (result.success) {
      logger.info(`LLM: Gemini succeeded (${result.latencyMs}ms)`);
      return result;
    }

    // Log fallback reason
    logger.warn(`LLM: Gemini failed (${result.error}), trying OpenRouter fallback`);
  } else {
    logger.warn('LLM: Gemini not available, using OpenRouter');
  }

  // Fallback to OpenRouter
  if (openRouter.isAvailable()) {
    const result = await openRouter.generate(prompt, options);
    if (result.success) {
      logger.info(`LLM: OpenRouter fallback succeeded (${result.latencyMs}ms)`);
      return result;
    }

    logger.error(`LLM: OpenRouter fallback also failed: ${result.error}`);
    return result;
  }

  // Neither provider available
  logger.error('LLM: No providers available (check GOOGLE_AI_API_KEY or OPENROUTER_API_KEY)');
  return {
    success: false,
    text: '',
    provider: 'none',
    error: 'No LLM providers configured',
  };
}

/**
 * Check if any LLM provider is available
 */
export function isLLMAvailable(): boolean {
  return getGeminiProvider().isAvailable() || getOpenRouterProvider().isAvailable();
}

/**
 * Get status of all providers
 */
export function getProviderStatus(): { gemini: boolean; openRouter: boolean } {
  return {
    gemini: getGeminiProvider().isAvailable(),
    openRouter: getOpenRouterProvider().isAvailable(),
  };
}

// Export provider classes for direct use if needed
export { GeminiProvider, OpenRouterProvider };
