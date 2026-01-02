/**
 * Sniper RAG System - Research Provider (Threadsponder Version)
 *
 * Uses OpenRouter embeddings (qwen/qwen3-embedding-8b) and DragonflyDB vector search
 * to retrieve "ammunition" for weaponizing replies with facts.
 *
 * Optimizations:
 * - Embedding cache with Redis (24h TTL)
 * - Query transformation for hostile comments
 * - Hybrid search (BM25 + Dense) with RRF fusion
 * - Adaptive topK filtering
 * - Embedding-based reranking
 * - Killer fact extraction
 */

import Redis from 'ioredis';
import OpenAI from 'openai';
import { randomUUID, createHash } from 'crypto';
import { logger } from '../utils/shared-logger.js';
import { rerankWithEmbeddings, RerankedResult } from '../utils/embedding-reranker.js';

// Embedding cache configuration
const EMBEDDING_CACHE_TTL = 86400; // 24 hours
const EMBEDDING_CACHE_PREFIX = 'embed:';

// Jina AI Reader for URL extraction
const JINA_READER_URL = 'https://r.jina.ai/';

// Embedding configuration
const EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';
const EMBEDDING_DIM = 1024; // Flexible: 32-4096, using 1024 for balance
const VECTOR_INDEX_NAME = 'idx:ammo';
const AMMO_PREFIX = 'ammo:';

// Chunk settings
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

interface AmmoChunk {
  content: string;
  source: string;
  chunkId: number;
}

interface SearchResult {
  content: string;
  source: string;
  score: number;
}

// Ingestion job tracking
interface IngestionJob {
  id: string;
  type: 'url' | 'file' | 'text';
  source: string;
  sourceName: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
    percentage: number;
  };
  errors: string[];
  startedAt: string;
  completedAt?: string;
  chunksIngested: number;
}

// Source metadata
interface SourceMetadata {
  sourceName: string;
  keywords: string[];
  keyFacts: string[];
  category: string;
  chunkCount: number;
  lastUpdated: string;
}

// Job queue keys
const JOB_KEYS = {
  job: (jobId: string) => `ingest:job:${jobId}`,
  progress: (jobId: string) => `ingest:progress:${jobId}`,
  errors: (jobId: string) => `ingest:errors:${jobId}`,
  queue: 'ingest:queue',
  active: 'ingest:active',
  sourceMetadata: (sourceName: string) => `ammo:meta:${sourceName.toLowerCase()}`
};

export class ResearchProvider {
  private redis: Redis;
  private openrouter: OpenAI;
  private indexCreated: boolean = false;

  constructor() {
    this.redis = new Redis({
      host: process.env.DRAGONFLY_HOST || 'localhost',
      port: parseInt(process.env.DRAGONFLY_PORT || '6379'),
    });

    this.openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.YOUR_SITE_URL || 'https://threadsponder.com',
        'X-Title': 'Threadsponder - Research'
      }
    });

    this.redis.on('connect', () => {
      logger.info('ResearchProvider connected to DragonflyDB');
    });

    this.redis.on('error', (err) => {
      logger.error('DragonflyDB connection error:', err);
    });
  }

  /**
   * Generate embedding using OpenRouter's qwen3-embedding-8b model (direct API call)
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
   * Transform hostile comment into searchable query
   * Extracts topic keywords to improve semantic matching with knowledge base
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
      'can\'t create': ['creativity', 'AI capabilities', 'originality'],
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

    // Extract capitalized words
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
   * Get embedding with Redis caching (24h TTL)
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const hash = createHash('md5').update(text).digest('hex');
      const cacheKey = `${EMBEDDING_CACHE_PREFIX}${hash}`;

      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug(`Embedding cache HIT: ${hash.substring(0, 8)}...`);
        return JSON.parse(cached);
      }

      logger.debug(`Embedding cache MISS: ${hash.substring(0, 8)}... - calling API`);
      const embedding = await this.getEmbeddingFromAPI(text);

      await this.redis.setex(cacheKey, EMBEDDING_CACHE_TTL, JSON.stringify(embedding));
      logger.debug(`Embedding cached: ${hash.substring(0, 8)}... (TTL: ${EMBEDDING_CACHE_TTL}s)`);

      return embedding;
    } catch (error) {
      logger.error('Embedding generation failed:', error);
      throw error;
    }
  }

  /**
   * Initialize DragonflyDB vector index
   */
  async initVectorIndex(): Promise<void> {
    if (this.indexCreated) return;

    try {
      try {
        await this.redis.call('FT.INFO', VECTOR_INDEX_NAME);
        logger.info('Vector index already exists');
        this.indexCreated = true;
        return;
      } catch (e) {
        // Index doesn't exist, create it
      }

      await this.redis.call(
        'FT.CREATE', VECTOR_INDEX_NAME,
        'ON', 'JSON',
        'PREFIX', '1', AMMO_PREFIX,
        'SCHEMA',
        '$.vector', 'AS', 'vector', 'VECTOR', 'HNSW', '6',
        'TYPE', 'FLOAT32', 'DIM', String(EMBEDDING_DIM), 'DISTANCE_METRIC', 'COSINE',
        '$.content', 'AS', 'content', 'TEXT',
        '$.source', 'AS', 'source', 'TEXT'
      );

      logger.info('Created vector index: ' + VECTOR_INDEX_NAME);
      this.indexCreated = true;
    } catch (error: any) {
      if (error.message?.includes('Index already exists')) {
        logger.info('Vector index already exists');
        this.indexCreated = true;
      } else {
        logger.error('Failed to create vector index:', error);
        throw error;
      }
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
   * BM25 keyword search using DragonflyDB FT.SEARCH with TEXT
   */
  private async bm25Search(query: string, topK: number = 10): Promise<SearchResult[]> {
    try {
      const keywords = query.split(/\s+/).filter(w => w.length > 2);
      if (keywords.length === 0) return [];

      const searchQuery = keywords.map(k => k.replace(/[^a-zA-Z0-9]/g, '')).join('|');

      const results = await this.redis.call(
        'FT.SEARCH', VECTOR_INDEX_NAME,
        `@content:(${searchQuery})`,
        'RETURN', '2', 'content', 'source',
        'LIMIT', '0', String(topK)
      ) as any[];

      const searchResults: SearchResult[] = [];

      if (results && results.length > 1) {
        for (let i = 1; i < results.length; i += 2) {
          const fields = results[i + 1];
          if (fields) {
            const result: SearchResult = { content: '', source: '', score: 0 };

            for (let j = 0; j < fields.length; j += 2) {
              const key = fields[j];
              const value = fields[j + 1];
              if (key === 'content') result.content = value;
              if (key === 'source') result.source = value;
            }

            result.score = 1 - (searchResults.length / topK);
            searchResults.push(result);
          }
        }
      }

      logger.info(`BM25 search found ${searchResults.length} results for "${searchQuery.substring(0, 30)}..."`);
      return searchResults;

    } catch (error) {
      logger.warn('BM25 search failed, returning empty:', error);
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) to combine dense and sparse search results
   */
  private reciprocalRankFusion(
    denseResults: SearchResult[],
    sparseResults: SearchResult[],
    k: number = 60
  ): SearchResult[] {
    const scores = new Map<string, { score: number; result: SearchResult }>();

    denseResults.forEach((r, i) => {
      const key = r.content.substring(0, 100);
      const current = scores.get(key);
      const rrfScore = 1 / (k + i + 1);

      if (current) {
        current.score += rrfScore;
      } else {
        scores.set(key, { score: rrfScore, result: r });
      }
    });

    sparseResults.forEach((r, i) => {
      const key = r.content.substring(0, 100);
      const current = scores.get(key);
      const rrfScore = 1 / (k + i + 1);

      if (current) {
        current.score += rrfScore;
      } else {
        scores.set(key, { score: rrfScore, result: r });
      }
    });

    const fused = Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, result }) => ({
        ...result,
        score
      }));

    logger.info(`RRF fusion: ${denseResults.length} dense + ${sparseResults.length} sparse → ${fused.length} unique results`);
    return fused;
  }

  /**
   * Hybrid search combining dense vector and BM25 sparse search with RRF fusion
   */
  async hybridSearchAmmo(query: string, topK: number = 5): Promise<SearchResult[]> {
    await this.initVectorIndex();

    try {
      const transformedQuery = await this.transformQueryForSearch(query);

      const [denseResults, sparseResults] = await Promise.all([
        this.vectorSearchAmmo(transformedQuery, topK * 2),
        this.bm25Search(transformedQuery, topK * 2)
      ]);

      const fusedResults = this.reciprocalRankFusion(denseResults, sparseResults, 60);

      return fusedResults.slice(0, topK);

    } catch (error) {
      logger.error('Hybrid search failed:', error);
      return [];
    }
  }

  /**
   * Vector-only search (internal, used by hybrid search)
   */
  private async vectorSearchAmmo(query: string, topK: number = 3): Promise<SearchResult[]> {
    try {
      const queryEmbed = await this.getEmbedding(query);

      const vectorBuffer = Buffer.from(new Float32Array(queryEmbed).buffer);

      const results = await this.redis.call(
        'FT.SEARCH', VECTOR_INDEX_NAME,
        `*=>[KNN ${topK} @vector $vec AS score]`,
        'PARAMS', '2', 'vec', vectorBuffer,
        'RETURN', '3', 'content', 'source', 'score',
        'SORTBY', 'score', 'ASC',
        'DIALECT', '2'
      ) as any[];

      const searchResults: SearchResult[] = [];

      if (results && results.length > 1) {
        for (let i = 1; i < results.length; i += 2) {
          const fields = results[i + 1];
          if (fields) {
            const result: SearchResult = { content: '', source: '', score: 0 };

            for (let j = 0; j < fields.length; j += 2) {
              const key = fields[j];
              const value = fields[j + 1];
              if (key === 'content') result.content = value;
              if (key === 'source') result.source = value;
              if (key === 'score') result.score = parseFloat(value);
            }

            searchResults.push(result);
          }
        }
      }

      return searchResults;

    } catch (error) {
      logger.error('Vector search failed:', error);
      return [];
    }
  }

  /**
   * Apply adaptive topK filtering based on score quality
   */
  private filterByScoreQuality(
    results: SearchResult[],
    maxResults: number = 3
  ): SearchResult[] {
    if (results.length === 0) return [];

    const topScore = results[0].score;
    const isRRFScore = topScore < 0.1;

    const threshold = isRRFScore
      ? topScore * 0.5
      : 0.6;

    const goodResults = results.filter(r => r.score >= threshold);

    if (goodResults.length === 0) {
      logger.warn(`Low confidence ammunition retrieval (top score: ${topScore.toFixed(4)})`);
      return results.slice(0, 1);
    }

    const filtered = goodResults.slice(0, maxResults);
    logger.info(`Adaptive filtering: ${results.length} → ${filtered.length} results (threshold: ${threshold.toFixed(4)})`);
    return filtered;
  }

  /**
   * Rerank search results using query-document embedding similarity
   */
  private async rerankSearchResults(
    query: string,
    results: SearchResult[],
    topK: number
  ): Promise<SearchResult[]> {
    if (results.length <= 1) return results;

    try {
      const queryEmbedding = await this.getEmbedding(query);

      const docEmbeddings = new Map<string, number[]>();
      const embedPromises = results.map(async (r) => {
        const embedding = await this.getEmbedding(r.content.substring(0, 500));
        docEmbeddings.set(r.content, embedding);
      });
      await Promise.all(embedPromises);

      const reranked = rerankWithEmbeddings(queryEmbedding, results, docEmbeddings, 0.3);

      return reranked.slice(0, topK).map(r => ({
        content: r.content,
        source: r.source,
        score: r.combinedScore
      }));

    } catch (error) {
      logger.warn('Reranking failed, using original order:', error);
      return results.slice(0, topK);
    }
  }

  /**
   * Search for relevant ammunition based on query
   * Uses hybrid search with query transformation, reranking, and adaptive filtering
   */
  async searchAmmo(query: string, topK: number = 3): Promise<SearchResult[]> {
    await this.initVectorIndex();

    try {
      const overFetchK = Math.min(topK * 4, 20);

      const results = await this.hybridSearchAmmo(query, overFetchK);

      if (results.length > 0) {
        const reranked = await this.rerankSearchResults(query, results, topK * 2);
        const filtered = this.filterByScoreQuality(reranked, topK);
        logger.info(`Hybrid→Rerank→Filter: ${results.length}→${reranked.length}→${filtered.length} ammunition`);
        return filtered;
      }

      logger.info('Hybrid search empty, falling back to vector-only');
      const transformedQuery = await this.transformQueryForSearch(query);
      const fallbackResults = await this.vectorSearchAmmo(transformedQuery, overFetchK);

      const reranked = await this.rerankSearchResults(query, fallbackResults, topK * 2);
      const filtered = this.filterByScoreQuality(reranked, topK);
      logger.info(`Vector fallback→Rerank→Filter: ${fallbackResults.length}→${reranked.length}→${filtered.length}`);
      return filtered;

    } catch (error) {
      logger.error('Ammo search failed:', error);
      return [];
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
   * Ingest from raw text content
   */
  async ingestFromText(text: string, sourceName: string, options?: {
    keywords?: string[];
    category?: string;
    keyFacts?: string[];
  }): Promise<{ jobId: string; chunksIngested: number }> {
    const jobId = randomUUID();

    try {
      const job: IngestionJob = {
        id: jobId,
        type: 'text',
        source: 'direct-text',
        sourceName,
        status: 'processing',
        progress: { total: 0, processed: 0, percentage: 0 },
        errors: [],
        startedAt: new Date().toISOString(),
        chunksIngested: 0
      };
      await this.redis.setex(JOB_KEYS.job(jobId), 86400, JSON.stringify(job));

      const chunks = this.chunkText(text);
      job.progress.total = chunks.length;

      await this.initVectorIndex();
      await this.deleteSource(sourceName);

      let ingested = 0;
      for (let i = 0; i < chunks.length; i++) {
        try {
          const embedding = await this.getEmbedding(chunks[i]);

          const key = `${AMMO_PREFIX}${sourceName}:${i}`;
          await this.redis.call(
            'JSON.SET', key, '$',
            JSON.stringify({
              vector: embedding,
              content: chunks[i],
              source: sourceName
            })
          );

          ingested++;
          job.progress.processed = i + 1;
          job.progress.percentage = Math.round(((i + 1) / chunks.length) * 100);

        } catch (error: any) {
          job.errors.push(`Chunk ${i}: ${error.message}`);
        }
      }

      // Store metadata
      const metadata: SourceMetadata = {
        sourceName,
        keywords: options?.keywords || [],
        keyFacts: options?.keyFacts || [],
        category: options?.category || 'general',
        chunkCount: ingested,
        lastUpdated: new Date().toISOString()
      };
      await this.redis.set(JOB_KEYS.sourceMetadata(sourceName), JSON.stringify(metadata));

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.chunksIngested = ingested;
      await this.redis.setex(JOB_KEYS.job(jobId), 86400, JSON.stringify(job));

      return { jobId, chunksIngested: ingested };

    } catch (error: any) {
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
        headers: {
          'Accept': 'text/plain'
        }
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
  async ingestFromUrl(url: string, sourceName: string, options?: {
    keywords?: string[];
    category?: string;
    keyFacts?: string[];
  }): Promise<{ jobId: string; chunksIngested: number }> {
    const text = await this.extractUrlContent(url);
    return this.ingestFromText(text, sourceName, options);
  }

  /**
   * Get list of all ingested sources
   */
  async listSources(): Promise<string[]> {
    const keys = await this.redis.keys(`${AMMO_PREFIX}*`);
    const sources = new Set<string>();

    for (const key of keys) {
      const parts = key.replace(AMMO_PREFIX, '').split(':');
      if (parts.length >= 1) {
        sources.add(parts[0]);
      }
    }

    return Array.from(sources);
  }

  /**
   * Delete all chunks from a source
   */
  async deleteSource(sourceName: string): Promise<number> {
    const keys = await this.redis.keys(`${AMMO_PREFIX}${sourceName}:*`);

    if (keys.length === 0) return 0;

    const deleted = await this.redis.del(...keys);
    await this.redis.del(JOB_KEYS.sourceMetadata(sourceName));

    logger.info(`Deleted ${deleted} chunks from source: ${sourceName}`);
    return deleted;
  }

  /**
   * Get embedding cache statistics
   */
  async getEmbeddingCacheStats(): Promise<{
    cacheKeyCount: number;
    estimatedSizeKB: number;
  }> {
    const keys = await this.redis.keys(`${EMBEDDING_CACHE_PREFIX}*`);
    const estimatedSizeKB = keys.length * 5;
    return {
      cacheKeyCount: keys.length,
      estimatedSizeKB
    };
  }

  /**
   * Clear embedding cache
   */
  async clearEmbeddingCache(): Promise<number> {
    const keys = await this.redis.keys(`${EMBEDDING_CACHE_PREFIX}*`);
    if (keys.length === 0) return 0;
    const deleted = await this.redis.del(...keys);
    logger.info(`Cleared ${deleted} embedding cache entries`);
    return deleted;
  }

  /**
   * Get stats about the vector store
   */
  async getStats(): Promise<{
    totalChunks: number;
    sources: string[];
    indexInfo: any;
  }> {
    const keys = await this.redis.keys(`${AMMO_PREFIX}*`);
    const sources = await this.listSources();

    let indexInfo = null;
    try {
      indexInfo = await this.redis.call('FT.INFO', VECTOR_INDEX_NAME);
    } catch (e) {
      // Index might not exist yet
    }

    return {
      totalChunks: keys.length,
      sources,
      indexInfo
    };
  }

  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('ResearchProvider connection closed');
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
