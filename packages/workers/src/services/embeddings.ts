/**
 * Embeddings Service
 *
 * Generates text embeddings via OpenRouter
 * Uses text-embedding-3-large (1024 dimensions)
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokensUsed: number;
}

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
  model: string = 'openai/text-embedding-3-large'
): Promise<EmbeddingResult | null> {
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://threadsponder.com',
        'X-Title': 'Threadsponder',
      },
      body: JSON.stringify({
        model,
        input: text,
        dimensions: 1024,
      }),
    });

    if (!response.ok) {
      console.error('Embedding API error:', response.status);
      return null;
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { total_tokens?: number };
    };

    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      console.error('No embedding in response');
      return null;
    }

    return {
      embedding,
      model,
      tokensUsed: data.usage?.total_tokens || 0,
    };
  } catch (error) {
    console.error('Embedding generation failed:', error);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts (batched)
 */
export async function generateEmbeddings(
  texts: string[],
  apiKey: string,
  model: string = 'openai/text-embedding-3-large'
): Promise<Array<EmbeddingResult | null>> {
  // Process in batches of 10 to avoid rate limits
  const batchSize = 10;
  const results: Array<EmbeddingResult | null> = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map((text) => generateEmbedding(text, apiKey, model))
    );

    results.push(...batchResults);

    // Small delay between batches
    if (i + batchSize < texts.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Chunk text into smaller pieces for embedding
 * Uses sentence boundaries when possible
 */
export function chunkText(
  text: string,
  maxChunkSize: number = 500,
  overlap: number = 50
): string[] {
  const chunks: string[] = [];

  // Split by paragraphs first
  const paragraphs = text.split(/\n\n+/);

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If paragraph itself is too long, split by sentences
    if (paragraph.length > maxChunkSize) {
      const sentences = paragraph.split(/(?<=[.!?])\s+/);

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxChunkSize) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            // Keep overlap from end of previous chunk
            const words = currentChunk.split(/\s+/);
            const overlapWords = words.slice(-Math.floor(overlap / 5));
            currentChunk = overlapWords.join(' ') + ' ' + sentence;
          } else {
            // Single sentence too long, force split
            chunks.push(sentence.substring(0, maxChunkSize));
            currentChunk = sentence.substring(maxChunkSize - overlap);
          }
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      }
    } else {
      if (currentChunk.length + paragraph.length > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 20); // Filter out tiny chunks
}

/**
 * Auto-classify tone of a text sample
 */
export async function classifyTone(
  text: string,
  apiKey: string
): Promise<'friendly' | 'neutral' | 'hostile'> {
  const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://threadsponder.com',
        'X-Title': 'Threadsponder',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct',
        messages: [
          {
            role: 'user',
            content: `Classify the tone of this text as exactly one of: friendly, neutral, hostile.

Text: "${text.substring(0, 300)}"

Reply with just one word: friendly, neutral, or hostile.`,
          },
        ],
        temperature: 0.1,
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      return 'neutral';
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const result = data.choices?.[0]?.message?.content?.toLowerCase().trim();

    if (result?.includes('friendly')) return 'friendly';
    if (result?.includes('hostile')) return 'hostile';
    return 'neutral';
  } catch {
    return 'neutral';
  }
}
