/**
 * Sniper RAG System - Research Provider (Threadsponder SaaS Version)
 *
 * Uses OpenRouter embeddings (qwen/qwen3-embedding-8b) and Supabase pgvector
 * for semantic search of "ammunition" facts.
 *
 * Architecture:
 * - Supabase pgvector: Vector storage and similarity search (persistent, tenant-isolated)
 * - Upstash Redis: Embedding cache (ephemeral, 24h TTL)
 * - OpenRouter: Embedding generation (qwen3-embedding-8b)
 *
 * Features:
 * - Hybrid search (BM25 + Dense) via Supabase function
 * - Embedding cache with Redis (24h TTL)
 * - Query transformation for hostile comments
 * - Killer fact extraction
 * - Multi-tenant isolation via account_id
 */

import OpenAI from 'openai';
import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../utils/shared-logger.js';
import { rerankWithEmbeddings } from '../utils/embedding-reranker.js';
import { getRedisClient } from '@threadsponder/shared';

// Embedding cache configuration
const EMBEDDING_CACHE_TTL = 86400; // 24 hours

// Embedding configuration
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const EMBEDDING_DIM = 1024;

// Jina AI Reader for URL extraction
const JINA_READER_URL = 'https://r.jina.ai/';

// Chunk settings
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

interface SearchResult {
  content: string;
  source: string;
  score: number;
  title?: string;
  category?: string;
}

interface AmmunitionRow {
  id: string;
  content: string;
  title: string | null;
  source: string | null;
  category: string | null;
  similarity?: number;
  vector_score?: number;
  keyword_score?: number;
  hybrid_score?: number;
}

export class ResearchProvider {
  private supabase: SupabaseClient;
  private openrouter: OpenAI;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for ResearchProvider');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.YOUR_SITE_URL || 'https://threadsponder.com',
        'X-Title': 'Threadsponder - Research'
      }
    });

    logger.info('ResearchProvider initialized with Supabase pgvector');
  }

  /**
   * Generate embedding using OpenRouter's qwen3-embedding-8b model
   */
  private async getEmbeddingFromAPI(text: string): Promise<number[]> {
    const response = await this.openrouter.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIM
    } as any);

    return response.data[0].embedding;
  }

  /**
   * Get embedding with Upstash Redis caching (24h TTL)
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const hash = createHash('md5').update(text).digest('hex');
      const cacheKey = `embed:${hash}`;
      const redis = getRedisClient();

      const cached = await redis.get<number[]>(cacheKey);
      if (cached) {
        logger.debug(`Embedding cache HIT: ${hash.substring(0, 8)}...`);
        return cached;
      }

      logger.debug(`Embedding cache MISS: ${hash.substring(0, 8)}... - calling API`);
      const embedding = await this.getEmbeddingFromAPI(text);

      await redis.set(cacheKey, embedding, { ex: EMBEDDING_CACHE_TTL });
      logger.debug(`Embedding cached: ${hash.substring(0, 8)}... (TTL: ${EMBEDDING_CACHE_TTL}s)`);

      return embedding;
    } catch (error) {
      logger.error('Embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Transform hostile comment into searchable query
   * Extracts topic keywords to improve semantic matching
   */
  async transformQueryForSearch(hostileComment: string): Promise<string> {
    try {
      const keywords = this.extractKeywordsFromComment(hostileComment);

      if (keywords.length > 0) {
        const transformed = keywords.join(' ');
        logger.info(`Query transformed: "${hostileComment.substring(0, 30)}..." → "${transformed}"`);
        return transformed;
      }

      return hostileComment;
    } catch (error) {
      logger.warn('Query transformation failed, using original:', error);
      return hostileComment;
    }
  }

  /**
   * Extract topic keywords from hostile comment using patterns
   */
  private extractKeywordsFromComment(text: string): string[] {
    const keywords: Set<string> = new Set();
    const lowerText = text.toLowerCase();

    const topicMappings: Record<string, string[]> = {
      // AI Art & Copyright
      'ai art': ['AI art', 'copyright', 'fair use', 'legal'],
      'stolen': ['theft', 'copyright', 'intellectual property'],
      'theft': ['theft', 'copyright', 'legal', 'fair use'],
      'steal': ['theft', 'copyright', 'training data'],
      'copyright': ['copyright', 'fair use', 'DMCA', 'legal'],
      'artist': ['artist', 'creator', 'copyright', 'compensation'],
      'training data': ['training data', 'dataset', 'consent', 'opt-out'],
      'midjourney': ['Midjourney', 'AI art', 'image generation'],
      'stable diffusion': ['Stable Diffusion', 'AI art', 'open source'],
      'dalle': ['DALL-E', 'OpenAI', 'AI art'],

      // AI & Jobs
      'job': ['jobs', 'employment', 'automation', 'workforce'],
      'replace': ['automation', 'jobs', 'AI replacement', 'workforce'],
      'unemploy': ['unemployment', 'jobs', 'automation', 'economic'],

      // AI Ethics
      'ethics': ['ethics', 'AI safety', 'responsible AI'],
      'bias': ['bias', 'fairness', 'discrimination', 'AI ethics'],
      'dangerous': ['AI safety', 'risk', 'alignment'],
      'skynet': ['AI safety', 'existential risk', 'sci-fi'],

      // AI Capabilities
      "can't create": ['creativity', 'AI capabilities', 'originality'],
      'not creative': ['creativity', 'AI capabilities', 'innovation'],
      'just pattern': ['pattern matching', 'understanding', 'intelligence'],
      'real artist': ['human artist', 'creativity', 'authenticity'],
      'soul': ['consciousness', 'creativity', 'authenticity'],

      // Legal
      'lawsuit': ['lawsuit', 'litigation', 'legal', 'court'],
      'sue': ['lawsuit', 'legal action', 'court'],
      'illegal': ['legal', 'law', 'regulation'],
      'court': ['court', 'ruling', 'legal', 'judge'],

      // Technical
      'llm': ['LLM', 'large language model', 'GPT'],
      'gpt': ['GPT', 'OpenAI', 'language model'],
      'chatgpt': ['ChatGPT', 'OpenAI', 'conversational AI'],
      'claude': ['Claude', 'Anthropic', 'AI assistant'],
      'hallucin': ['hallucination', 'accuracy', 'reliability'],
      'wrong': ['accuracy', 'errors', 'reliability'],
      'mistake': ['errors', 'accuracy', 'reliability']
    };

    for (const [pattern, terms] of Object.entries(topicMappings)) {
      if (lowerText.includes(pattern)) {
        terms.forEach(term => keywords.add(term));
      }
    }

    // Extract quoted phrases
    const quotedPhrases = text.match(/"[^"]+"/g) || [];
    quotedPhrases.forEach(phrase => {
      const cleaned = phrase.replace(/"/g, '').trim();
      if (cleaned.length > 3 && cleaned.length < 50) {
        keywords.add(cleaned);
      }
    });

    // Extract capitalized words (proper nouns)
    const capitalWords = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    capitalWords.forEach(word => {
      if (word.length > 2 && !['The', 'This', 'That', 'What', 'Why', 'How', 'You', 'Your'].includes(word)) {
        keywords.add(word);
      }
    });

    // Extract acronyms
    const acronyms = text.match(/\b[A-Z]{2,6}\b/g) || [];
    acronyms.forEach(acr => {
      if (!['OK', 'LOL', 'WTF', 'LMAO', 'OMG', 'FYI', 'BTW'].includes(acr)) {
        keywords.add(acr);
      }
    });

    return Array.from(keywords);
  }

  /**
   * Search for ammunition using Supabase pgvector hybrid search
   * Tenant-isolated via account_id
   */
  async searchAmmo(accountId: string, query: string, topK: number = 3): Promise<SearchResult[]> {
    try {
      const transformedQuery = await this.transformQueryForSearch(query);
      const queryEmbedding = await this.getEmbedding(transformedQuery);

      // Use Supabase's hybrid_search_ammunition function
      const { data, error } = await this.supabase.rpc('hybrid_search_ammunition', {
        p_account_id: accountId,
        p_query: transformedQuery,
        p_embedding: queryEmbedding,
        p_alpha: 0.7, // 70% vector, 30% keyword
        p_limit: topK * 2 // Over-fetch for reranking
      });

      if (error) {
        logger.error('Hybrid search error:', error);
        // Fall back to vector-only search
        return this.vectorOnlySearch(accountId, queryEmbedding, topK);
      }

      if (!data || data.length === 0) {
        logger.info('No ammunition found for query');
        return [];
      }

      // Convert to SearchResult format
      const results: SearchResult[] = (data as AmmunitionRow[]).map(row => ({
        content: row.content,
        source: row.source || 'unknown',
        title: row.title || undefined,
        category: row.category || undefined,
        score: row.hybrid_score || row.similarity || 0
      }));

      // Rerank using embeddings
      const reranked = await this.rerankResults(query, results, topK);
      logger.info(`Hybrid search: ${results.length} results → ${reranked.length} after reranking`);
      return reranked;

    } catch (error) {
      logger.error('Ammunition search failed:', error);
      return [];
    }
  }

  /**
   * Vector-only search fallback using Supabase
   */
  private async vectorOnlySearch(accountId: string, embedding: number[], topK: number): Promise<SearchResult[]> {
    try {
      const { data, error } = await this.supabase.rpc('search_ammunition', {
        p_account_id: accountId,
        p_embedding: embedding,
        p_limit: topK
      });

      if (error) {
        logger.error('Vector search error:', error);
        return [];
      }

      return (data as AmmunitionRow[]).map(row => ({
        content: row.content,
        source: row.source || 'unknown',
        title: row.title || undefined,
        category: row.category || undefined,
        score: row.similarity || 0
      }));
    } catch (error) {
      logger.error('Vector-only search failed:', error);
      return [];
    }
  }

  /**
   * Rerank results using query-document embedding similarity
   */
  private async rerankResults(query: string, results: SearchResult[], topK: number): Promise<SearchResult[]> {
    if (results.length <= 1) return results;

    try {
      const queryEmbedding = await this.getEmbedding(query);
      const docEmbeddings = new Map<string, number[]>();

      await Promise.all(results.map(async (r) => {
        const embedding = await this.getEmbedding(r.content.substring(0, 500));
        docEmbeddings.set(r.content, embedding);
      }));

      const reranked = rerankWithEmbeddings(queryEmbedding, results, docEmbeddings, 0.3);

      return reranked.slice(0, topK).map(r => ({
        content: r.content,
        source: r.source,
        title: r.title,
        category: r.category,
        score: r.combinedScore
      }));
    } catch (error) {
      logger.warn('Reranking failed, using original order:', error);
      return results.slice(0, topK);
    }
  }

  /**
   * Extract the "killer fact" from a chunk using pattern matching
   */
  private extractKillerFact(chunk: string): string {
    const patterns = [
      /(?:judge|court|ruling)\s+\w+\s+(?:ruled|found|held|stated|determined)[^.]+\./i,
      /(?:ruling|decision|case)\s+(?:established|confirmed|set|determined)[^.]+\./i,
      /(?:\d+(?:\.\d+)?%|\d+(?:,\d+)*)\s+(?:of|percent|million|billion)[^.]+\./i,
      /(?:according to|research shows|studies show|experts|scientists|researchers)[^.]+\./i,
      /(?:found that|concluded that|showed that|proved that|demonstrated that)[^.]+\./i,
      /"[^"]{20,150}"/,
      /(?:ruled|found|stated|showed|determined|concluded)[^.]+\./i
    ];

    for (const pattern of patterns) {
      const match = chunk.match(pattern);
      if (match && match[0].length > 30) {
        return match[0].trim();
      }
    }

    const sentences = chunk.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (sentence.length > 40 && sentence.length < 200) {
        return sentence.trim();
      }
    }

    return chunk.substring(0, 150).trim() + (chunk.length > 150 ? '...' : '');
  }

  /**
   * Format ammunition for prompt injection
   */
  formatAmmoForPrompt(results: SearchResult[]): string {
    if (results.length === 0) return '';

    const killerFacts = results.map(r => ({
      fact: this.extractKillerFact(r.content),
      source: r.source,
      score: r.score
    }));

    const formatted = killerFacts.map(kf =>
      `- ${kf.fact} [${kf.source}]`
    ).join('\n');

    return `
[AMMUNITION - USE ONE FACT TO DUNK]
${formatted}

INSTRUCTION: Pick the BEST fact above to destroy their argument.
- Cite source briefly (e.g. "judge alsup ruled", "MIT study showed").
- Keep reply SHORT and dismissive.
- Example: "federal judge alsup ruled AI training is fair use. next."
`;
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Check if text is too similar to recent outputs (bot loop detection)
   */
  async isBotLoop(incomingText: string, recentOutputs: string[]): Promise<boolean> {
    if (recentOutputs.length === 0) return false;

    try {
      const incomingEmbed = await this.getEmbedding(incomingText);

      for (const output of recentOutputs) {
        const outputEmbed = await this.getEmbedding(output);
        const similarity = this.cosineSimilarity(incomingEmbed, outputEmbed);

        if (similarity > 0.9) {
          logger.warn(`Bot loop detected: similarity ${similarity.toFixed(3)} with "${output.substring(0, 50)}..."`);
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Bot loop check failed:', error);
      return false;
    }
  }

  /**
   * Simple text chunking
   */
  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length);
      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      const nextStart = end - CHUNK_OVERLAP;
      start = nextStart > start ? nextStart : start + CHUNK_SIZE;
    }

    return chunks.filter(c => c.length > 20);
  }

  /**
   * Ingest ammunition from raw text content
   * Stores in Supabase with pgvector embeddings
   */
  async ingestFromText(accountId: string, text: string, sourceName: string, options?: {
    category?: 'legal' | 'statistical' | 'technical' | 'historical' | 'quotation' | 'definition' | 'general';
    tags?: string[];
    title?: string;
  }): Promise<{ chunksIngested: number }> {
    try {
      const chunks = this.chunkText(text);
      logger.info(`Ingesting ${chunks.length} chunks from "${sourceName}" for account ${accountId}`);

      let ingested = 0;
      for (const chunk of chunks) {
        const embedding = await this.getEmbedding(chunk);

        const { error } = await this.supabase.from('ammunition').insert({
          account_id: accountId,
          content: chunk,
          source: sourceName,
          source_type: 'manual',
          title: options?.title,
          category: options?.category || 'general',
          tags: options?.tags || [],
          embedding: embedding
        });

        if (error) {
          logger.error(`Failed to insert chunk: ${error.message}`);
        } else {
          ingested++;
        }
      }

      logger.info(`Ingested ${ingested}/${chunks.length} chunks for "${sourceName}"`);
      return { chunksIngested: ingested };
    } catch (error) {
      logger.error('Text ingestion failed:', error);
      throw error;
    }
  }

  /**
   * Extract text content from URL using Jina AI Reader
   */
  async extractUrlContent(url: string): Promise<string> {
    try {
      const jinaUrl = `${JINA_READER_URL}${url}`;
      logger.info(`Fetching URL via Jina AI: ${url}`);

      const response = await fetch(jinaUrl, {
        headers: { 'Accept': 'text/plain' }
      });

      if (!response.ok) {
        throw new Error(`Jina AI returned ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      logger.info(`Extracted ${text.length} chars from URL`);
      return text;
    } catch (error) {
      logger.error('URL extraction failed:', error);
      throw error;
    }
  }

  /**
   * Ingest content from URL
   */
  async ingestFromUrl(accountId: string, url: string, sourceName: string, options?: {
    category?: 'legal' | 'statistical' | 'technical' | 'historical' | 'quotation' | 'definition' | 'general';
    tags?: string[];
    title?: string;
  }): Promise<{ chunksIngested: number }> {
    const text = await this.extractUrlContent(url);
    return this.ingestFromText(accountId, text, sourceName, options);
  }

  /**
   * List all sources for an account
   */
  async listSources(accountId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('ammunition')
      .select('source')
      .eq('account_id', accountId)
      .eq('is_active', true);

    if (error) {
      logger.error('Failed to list sources:', error);
      return [];
    }

    const sources = new Set<string>();
    data?.forEach(row => {
      if (row.source) sources.add(row.source);
    });
    return Array.from(sources);
  }

  /**
   * Delete all ammunition from a source
   */
  async deleteSource(accountId: string, sourceName: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('ammunition')
      .delete()
      .eq('account_id', accountId)
      .eq('source', sourceName)
      .select('id');

    if (error) {
      logger.error('Failed to delete source:', error);
      return 0;
    }

    const deleted = data?.length || 0;
    logger.info(`Deleted ${deleted} ammunition entries from source: ${sourceName}`);
    return deleted;
  }

  /**
   * Get stats about the ammunition store for an account
   */
  async getStats(accountId: string): Promise<{
    totalChunks: number;
    sources: string[];
    byCategory: Record<string, number>;
  }> {
    const { data, error } = await this.supabase
      .from('ammunition')
      .select('id, source, category')
      .eq('account_id', accountId)
      .eq('is_active', true);

    if (error) {
      logger.error('Failed to get stats:', error);
      return { totalChunks: 0, sources: [], byCategory: {} };
    }

    const sources = new Set<string>();
    const byCategory: Record<string, number> = {};

    data?.forEach(row => {
      if (row.source) sources.add(row.source);
      const cat = row.category || 'general';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    return {
      totalChunks: data?.length || 0,
      sources: Array.from(sources),
      byCategory
    };
  }

  /**
   * Get embedding cache statistics from Upstash Redis
   */
  async getEmbeddingCacheStats(): Promise<{
    estimatedCount: number;
  }> {
    // Note: Upstash doesn't support KEYS command efficiently
    // This is a limitation - we can't easily count cache entries
    return { estimatedCount: -1 }; // Unknown
  }

  /**
   * Clear embedding cache (limited functionality with Upstash)
   */
  async clearEmbeddingCache(): Promise<number> {
    // Upstash doesn't support KEYS * efficiently
    // Would need to implement with a scan pattern or maintain a set of keys
    logger.warn('Embedding cache clear not supported with Upstash REST API');
    return 0;
  }

  async close(): Promise<void> {
    // Supabase client doesn't need explicit close
    logger.info('ResearchProvider closed');
  }
}

// Singleton instance
let researchProviderInstance: ResearchProvider | null = null;

export function getResearchProvider(): ResearchProvider {
  if (!researchProviderInstance) {
    researchProviderInstance = new ResearchProvider();
  }
  return researchProviderInstance;
}
