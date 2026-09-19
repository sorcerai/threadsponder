/**
 * Voice Processor Job
 *
 * Processes uploaded documents for voice training:
 * 1. Read document from local filesystem
 * 2. Extract and chunk text
 * 3. Classify tone of each chunk
 * 4. Generate embeddings
 * 5. Store in voice_examples table (SQLite)
 */

import fs from 'fs';
import { getDb } from '@threadsponder/shared';
import {
  generateEmbedding,
  classifyTone,
} from '../services/embeddings.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Chonkie chunker instance (lazy-loaded)
interface ChonkieChunker {
  chunk: (text: string) => Promise<Array<{ text?: string } | string>>;
}
let chunkerInstance: ChonkieChunker | null = null;

/**
 * Get or create Chonkie sentence chunker
 * Uses Chonkie 0.2.6 for semantic sentence-based chunking
 */
async function getChunker() {
  if (!chunkerInstance) {
    const chonkie = await import('chonkie');
    chunkerInstance = await chonkie.SentenceChunker.create({
      chunkSize: 512,
      chunkOverlap: 50,
    });
  }
  return chunkerInstance;
}

/**
 * Chunk text using Chonkie semantic chunking
 */
async function chunkTextWithChonkie(text: string): Promise<string[]> {
  try {
    const chunker = await getChunker();
    const chunks = await chunker.chunk(text);
    return chunks.map((c) => (typeof c === 'string' ? c : c.text || ''));
  } catch (error) {
    console.warn('[VoiceProcessor] Chonkie failed, using fallback:', error);
    return text
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length >= 20);
  }
}

/**
 * Extract text from document
 * Supports: .txt, .md, .pdf, .docx
 */
async function extractText(content: ArrayBuffer, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();
  const buffer = Buffer.from(content);

  switch (ext) {
    case 'txt':
    case 'md':
      return new TextDecoder().decode(content);

    case 'pdf': {
      type PdfParse = (buffer: Buffer) => Promise<{ text: string }>;
      const pdfModule = (await import('pdf-parse')) as unknown as { default?: PdfParse } & PdfParse;
      const parser: PdfParse = pdfModule.default ?? pdfModule;
      const pdfData = await parser(buffer);
      return pdfData.text;
    }

    case 'docx': {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    default:
      try {
        return new TextDecoder().decode(content);
      } catch {
        throw new Error(`Unsupported file type: ${ext}`);
      }
  }
}

function updateDocumentStatus(
  documentId: string,
  status: 'pending' | 'processing' | 'done' | 'failed'
): void {
  const db = getDb();
  db.prepare('UPDATE voice_processing_queue SET status = ? WHERE document_id = ?')
    .run(status, documentId);
}

/**
 * Process a voice training document from a local file path.
 */
export async function runVoiceProcessor(
  accountId: string,
  documentId: string,
  filePath: string
): Promise<{ chunksProcessed: number; examplesCreated: number }> {
  console.log(`[VoiceProcessor] Processing document ${documentId}`);

  updateDocumentStatus(documentId, 'processing');

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    ) as ArrayBuffer;
    const filename = filePath.split('/').pop() || 'document.txt';
    const text = await extractText(arrayBuffer, filename);

    if (!text || text.length < 50) {
      throw new Error('Document too short or empty');
    }

    console.log(`[VoiceProcessor] Extracted ${text.length} chars from ${filename}`);

    const chunks = await chunkTextWithChonkie(text);
    console.log(`[VoiceProcessor] Created ${chunks.length} chunks (Chonkie)`);

    let examplesCreated = 0;

    for (const chunk of chunks) {
      const tone = await classifyTone(chunk, OPENROUTER_API_KEY);
      const embeddingResult = await generateEmbedding(chunk, OPENROUTER_API_KEY);

      const db = getDb();
      db.prepare(
        'INSERT INTO voice_examples (account_id, text, tone, embedding, source) VALUES (?, ?, ?, ?, ?)'
      ).run(
        accountId,
        chunk,
        tone,
        embeddingResult ? JSON.stringify(embeddingResult.embedding) : null,
        'document'
      );
      examplesCreated++;

      await new Promise((r) => setTimeout(r, 200));
    }

    updateDocumentStatus(documentId, 'done');

    console.log(
      `[VoiceProcessor] Completed: ${chunks.length} chunks, ${examplesCreated} examples`
    );

    return { chunksProcessed: chunks.length, examplesCreated };
  } catch (error) {
    console.error(`[VoiceProcessor] Failed:`, error);
    updateDocumentStatus(documentId, 'failed');
    throw error;
  }
}
