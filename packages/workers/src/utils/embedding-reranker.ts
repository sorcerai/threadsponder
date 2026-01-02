/**
 * Lightweight Embedding-based Reranker
 *
 * Uses cosine similarity between query and document embeddings
 * to rerank search results. Leverages embedding cache for speed.
 *
 * Alternative to FlashRank (Python) for TypeScript environments.
 */

import { logger } from './shared-logger.js';

export interface RerankedResult {
  content: string;
  source: string;
  originalScore: number;
  rerankedScore: number;
  combinedScore: number;
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
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
 * Rerank results using embedding similarity
 *
 * @param queryEmbedding - The query embedding vector
 * @param results - Search results with content and scores
 * @param documentEmbeddings - Map of content -> embedding
 * @param alpha - Weight for original score (0-1). Default 0.3 (70% rerank, 30% original)
 * @returns Reranked results sorted by combined score
 */
export function rerankWithEmbeddings(
  queryEmbedding: number[],
  results: Array<{ content: string; source: string; score: number }>,
  documentEmbeddings: Map<string, number[]>,
  alpha: number = 0.3
): RerankedResult[] {
  if (results.length === 0) return [];

  const reranked: RerankedResult[] = [];

  for (const result of results) {
    const docEmbedding = documentEmbeddings.get(result.content);

    if (!docEmbedding) {
      // No embedding available, use original score
      reranked.push({
        content: result.content,
        source: result.source,
        originalScore: result.score,
        rerankedScore: result.score,
        combinedScore: result.score
      });
      continue;
    }

    // Compute cosine similarity for reranking
    const rerankedScore = cosineSimilarity(queryEmbedding, docEmbedding);

    // Normalize original score to 0-1 range if needed
    const normalizedOriginal = result.score > 1 ? result.score / 100 : result.score;

    // Combined score: weighted average
    const combinedScore = alpha * normalizedOriginal + (1 - alpha) * rerankedScore;

    reranked.push({
      content: result.content,
      source: result.source,
      originalScore: result.score,
      rerankedScore,
      combinedScore
    });
  }

  // Sort by combined score descending
  reranked.sort((a, b) => b.combinedScore - a.combinedScore);

  logger.debug(`Reranked ${results.length} results. Top score: ${reranked[0]?.combinedScore.toFixed(4)}`);

  return reranked;
}

/**
 * Simple rerank by query-document similarity only (no original score)
 */
export function simpleRerank(
  queryEmbedding: number[],
  documents: string[],
  documentEmbeddings: Map<string, number[]>
): Array<{ document: string; score: number }> {
  const scored = documents.map(doc => {
    const embedding = documentEmbeddings.get(doc);
    const score = embedding ? cosineSimilarity(queryEmbedding, embedding) : 0;
    return { document: doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
