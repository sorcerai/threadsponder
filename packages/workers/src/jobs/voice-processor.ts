/**
 * Voice Processor Job
 *
 * Processes uploaded documents for voice training:
 * 1. Download document from Supabase Storage
 * 2. Extract and chunk text
 * 3. Classify tone of each chunk
 * 4. Generate embeddings
 * 5. Store in voice_examples table
 */

import { Job, Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  generateEmbedding,
  chunkText,
  classifyTone,
} from '../services/embeddings.js';

export interface VoiceProcessorJobData {
  accountId: string;
  documentId: string;
  storagePath: string;
}

const REDIS_URL = process.env.UPSTASH_REDIS_URL || 'redis://localhost:6379';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const voiceProcessorQueue = new Queue<VoiceProcessorJobData>(
  'voice-processor',
  { connection }
);

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabase;
}

/**
 * Update document processing status
 */
async function updateDocumentStatus(
  documentId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  updates: { chunks_processed?: number; examples_created?: number; error_message?: string } = {}
): Promise<void> {
  await getSupabase()
    .from('voice_documents')
    .update({
      status,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', documentId);
}

/**
 * Extract text from document (supports .txt, .md, simple extraction)
 * For PDF/DOCX, would need additional libraries
 */
async function extractText(content: ArrayBuffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext === 'txt' || ext === 'md') {
    return new TextDecoder().decode(content);
  }

  // For now, treat everything as text
  // TODO: Add PDF/DOCX parsing with pdf-parse, mammoth
  try {
    return new TextDecoder().decode(content);
  } catch {
    throw new Error(`Unsupported file type: ${ext}`);
  }
}

/**
 * Process a voice training document
 */
async function processVoiceDocument(
  job: Job<VoiceProcessorJobData>
): Promise<{ chunksProcessed: number; examplesCreated: number }> {
  const { accountId, documentId, storagePath } = job.data;

  console.log(`[VoiceProcessor] Processing document ${documentId}`);

  // Update status to processing
  await updateDocumentStatus(documentId, 'processing');

  try {
    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await getSupabase()
      .storage
      .from('voice-documents')
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    // Get filename from path
    const filename = storagePath.split('/').pop() || 'document.txt';

    // Extract text
    const arrayBuffer = await fileData.arrayBuffer();
    const text = await extractText(arrayBuffer, filename);

    if (!text || text.length < 50) {
      throw new Error('Document too short or empty');
    }

    console.log(`[VoiceProcessor] Extracted ${text.length} chars from ${filename}`);

    // Chunk the text
    const chunks = chunkText(text, 400, 50);
    console.log(`[VoiceProcessor] Created ${chunks.length} chunks`);

    let examplesCreated = 0;

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Update progress
      await updateDocumentStatus(documentId, 'processing', {
        chunks_processed: i + 1,
        examples_created: examplesCreated,
      });

      // Classify tone
      const tone = await classifyTone(chunk, OPENROUTER_API_KEY);

      // Generate embedding
      const embeddingResult = await generateEmbedding(chunk, OPENROUTER_API_KEY);

      if (embeddingResult) {
        // Store in voice_examples
        const { error: insertError } = await getSupabase()
          .from('voice_examples')
          .insert({
            account_id: accountId,
            text: chunk,
            tone,
            embedding: embeddingResult.embedding,
            source: 'document',
            is_active: true,
          });

        if (!insertError) {
          examplesCreated++;
        } else {
          console.error(`[VoiceProcessor] Failed to insert example:`, insertError);
        }
      }

      // Small delay to avoid rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    // Mark as completed
    await updateDocumentStatus(documentId, 'completed', {
      chunks_processed: chunks.length,
      examples_created: examplesCreated,
    });

    console.log(
      `[VoiceProcessor] Completed: ${chunks.length} chunks, ${examplesCreated} examples`
    );

    return { chunksProcessed: chunks.length, examplesCreated };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[VoiceProcessor] Failed:`, error);

    await updateDocumentStatus(documentId, 'failed', {
      error_message: errorMessage,
    });

    throw error;
  }
}

// Create worker
export const voiceProcessorWorker = new Worker<VoiceProcessorJobData>(
  'voice-processor',
  processVoiceDocument,
  {
    connection,
    concurrency: 2, // Process 2 documents at a time
  }
);

voiceProcessorWorker.on('failed', (job, err) => {
  console.error(`[VoiceProcessor] Job ${job?.id} failed:`, err);
});

voiceProcessorWorker.on('completed', (job, result) => {
  console.log(
    `[VoiceProcessor] Job ${job.id} completed: ${result.chunksProcessed} chunks, ${result.examplesCreated} examples`
  );
});
