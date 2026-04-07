/**
 * Voice Routes
 *
 * Voice training examples and settings (SQLite + local filesystem)
 */

import express, { Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DOCUMENTS_PER_USER = 20;

function getUploadDir(): string {
  const dir = process.env.VOICE_UPLOAD_DIR || './voice-uploads';
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * GET /api/voice/examples
 * List voice examples
 */
router.get('/examples', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const tone = req.query.tone as string | undefined;
    const db = getDb();

    let sql = 'SELECT id, text, tone, source, created_at FROM voice_examples WHERE account_id = ?';
    const params: unknown[] = [accountId];

    if (tone) {
      sql += ' AND tone = ?';
      params.push(tone);
    }

    sql += ' ORDER BY created_at DESC';

    const examples = db.prepare(sql).all(...params);

    res.json({ examples });
  } catch (error) {
    console.error('[Voice] Failed to list examples:', error);
    res.status(500).json({ error: 'Failed to list examples' });
  }
});

/**
 * POST /api/voice/examples
 * Add a voice example
 */
router.post('/examples', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { text, tone } = req.body;

    if (!text || typeof text !== 'string' || text.length < 10 || text.length > 1000) {
      return res.status(400).json({ error: 'text must be 10-1000 characters' });
    }

    const validTones = ['friendly', 'neutral', 'hostile'];
    if (!tone || !validTones.includes(tone)) {
      return res.status(400).json({ error: 'tone must be friendly, neutral, or hostile' });
    }

    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO voice_examples (id, account_id, text, tone, source, created_at)
       VALUES (?, ?, ?, ?, 'manual', datetime('now'))`
    ).run(id, accountId, text, tone);

    const example = db.prepare(
      'SELECT id, text, tone, source, created_at FROM voice_examples WHERE id = ?'
    ).get(id);

    // Fire-and-forget embedding generation
    const exampleText: string = text;
    const exampleId: string = id;
    (async () => {
      try {
        const apiKey = process.env.OPENROUTER_API_KEY || '';
        if (!apiKey) return;
        const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://threadsponder.com',
            'X-Title': 'Threadsponder',
          },
          body: JSON.stringify({
            model: 'openai/text-embedding-3-large',
            input: exampleText,
            dimensions: 1024,
          }),
        });
        if (response.ok) {
          const result = await response.json() as { data?: Array<{ embedding?: number[] }> };
          const embedding = result.data?.[0]?.embedding;
          if (embedding) {
            getDb().prepare('UPDATE voice_examples SET embedding = ? WHERE id = ?')
              .run(JSON.stringify(embedding), exampleId);
          }
        }
      } catch (err) {
        console.warn('[Voice] Background embedding generation failed:', err);
      }
    })();

    res.json({ success: true, example });
  } catch (error) {
    console.error('[Voice] Failed to add example:', error);
    res.status(500).json({ error: 'Failed to add example' });
  }
});

/**
 * DELETE /api/voice/examples/:id
 * Delete a voice example
 */
router.delete('/examples/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    db.prepare('DELETE FROM voice_examples WHERE id = ? AND account_id = ?').run(id, accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('[Voice] Failed to delete example:', error);
    res.status(500).json({ error: 'Failed to delete example' });
  }
});

/**
 * GET /api/voice/settings
 * Get voice settings
 */
router.get('/settings', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const row = db.prepare(
      'SELECT formality, brevity, aggression, emoji_usage, custom_instructions FROM voice_settings WHERE account_id = ?'
    ).get(accountId) as {
      formality: number;
      brevity: number;
      aggression: number;
      emoji_usage: number;
      custom_instructions: string | null;
    } | undefined;

    const settings = row || {
      formality: 0.3,
      brevity: 0.2,
      emoji_usage: 0.4,
      aggression: 0.5,
      custom_instructions: null,
    };

    res.json({ settings });
  } catch (error) {
    console.error('[Voice] Failed to get settings:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * PUT /api/voice/settings
 * Update voice settings
 */
router.put('/settings', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { formality, brevity, aggression, emoji_usage, custom_instructions } = req.body;
    const db = getDb();

    db.prepare(`
      INSERT INTO voice_settings (id, account_id, formality, brevity, aggression, emoji_usage, custom_instructions, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(account_id) DO UPDATE SET
        formality = COALESCE(excluded.formality, formality),
        brevity = COALESCE(excluded.brevity, brevity),
        aggression = COALESCE(excluded.aggression, aggression),
        emoji_usage = COALESCE(excluded.emoji_usage, emoji_usage),
        custom_instructions = excluded.custom_instructions,
        updated_at = datetime('now')
    `).run(
      crypto.randomUUID(),
      accountId,
      formality ?? null,
      brevity ?? null,
      aggression ?? null,
      emoji_usage ?? null,
      custom_instructions ?? null
    );

    const settings = db.prepare(
      'SELECT formality, brevity, aggression, emoji_usage, custom_instructions FROM voice_settings WHERE account_id = ?'
    ).get(accountId);

    res.json({ success: true, settings });
  } catch (error) {
    console.error('[Voice] Failed to update settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/voice/documents
 * List uploaded documents (from voice_processing_queue)
 */
router.get('/documents', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const documents = db.prepare(
      'SELECT id, document_id, status, created_at FROM voice_processing_queue WHERE account_id = ? ORDER BY created_at DESC'
    ).all(accountId);

    res.json({ documents });
  } catch (error) {
    console.error('[Voice] Failed to list documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * POST /api/voice/documents/upload
 * Upload a file for voice training (with base64 file data)
 */
router.post('/documents/upload', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { filename, fileSize, fileData } = req.body;

    if (!filename || !fileData) {
      return res.status(400).json({ error: 'filename and fileData required' });
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    const supportedTypes = ['txt', 'md', 'pdf', 'docx'];
    if (!ext || !supportedTypes.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type. Supported: ${supportedTypes.join(', ')}`,
      });
    }

    const db = getDb();

    // Check document count limit (count non-done items)
    const countRow = db.prepare(
      "SELECT COUNT(*) as count FROM voice_processing_queue WHERE account_id = ? AND status != 'done'"
    ).get(accountId) as { count: number };

    if (countRow.count >= MAX_DOCUMENTS_PER_USER) {
      return res.status(400).json({
        error: `Maximum ${MAX_DOCUMENTS_PER_USER} documents allowed. Delete some to upload more.`,
      });
    }

    // Save file to local filesystem
    const uploadDir = getUploadDir();
    const storedFilename = `${Date.now()}-${filename}`;
    const filePath = path.join(uploadDir, accountId);
    fs.mkdirSync(filePath, { recursive: true });
    const fullPath = path.join(filePath, storedFilename);

    const buffer = Buffer.from(fileData, 'base64');
    fs.writeFileSync(fullPath, buffer);

    const id = crypto.randomUUID();
    const documentId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO voice_processing_queue (id, account_id, document_id, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`
    ).run(id, accountId, documentId);

    const document = db.prepare(
      'SELECT id, document_id, status, created_at FROM voice_processing_queue WHERE id = ?'
    ).get(id);

    console.log(`[Voice] Uploaded ${filename} to ${fullPath}`);

    res.json({ success: true, document, jobId: null });
  } catch (error) {
    console.error('[Voice] Failed to upload document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * DELETE /api/voice/documents/:id
 * Delete a voice document
 */
router.delete('/documents/:id', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const db = getDb();

    const doc = db.prepare(
      'SELECT id, document_id FROM voice_processing_queue WHERE id = ? AND account_id = ?'
    ).get(id, accountId) as { id: string; document_id: string } | undefined;

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Try to clean up local file (best-effort)
    try {
      const uploadDir = getUploadDir();
      const accountDir = path.join(uploadDir, accountId);
      if (fs.existsSync(accountDir)) {
        const files = fs.readdirSync(accountDir);
        for (const file of files) {
          if (file.includes(doc.document_id)) {
            fs.unlinkSync(path.join(accountDir, file));
          }
        }
      }
    } catch (fsErr) {
      console.warn('[Voice] Could not delete file:', fsErr);
    }

    db.prepare('DELETE FROM voice_processing_queue WHERE id = ? AND account_id = ?').run(id, accountId);

    res.json({ success: true });
  } catch (error) {
    console.error('[Voice] Failed to delete document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /api/voice/documents
 * Upload a document for voice training (legacy: expects storagePath)
 */
router.post('/documents', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { filename, fileSize } = req.body;

    if (!filename) {
      return res.status(400).json({ error: 'filename required' });
    }

    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    const ext = filename.split('.').pop()?.toLowerCase();
    const supportedTypes = ['txt', 'md', 'pdf', 'docx'];
    if (!ext || !supportedTypes.includes(ext)) {
      return res.status(400).json({
        error: `Unsupported file type. Supported: ${supportedTypes.join(', ')}`,
      });
    }

    const db = getDb();

    const countRow = db.prepare(
      "SELECT COUNT(*) as count FROM voice_processing_queue WHERE account_id = ? AND status != 'done'"
    ).get(accountId) as { count: number };

    if (countRow.count >= MAX_DOCUMENTS_PER_USER) {
      return res.status(400).json({
        error: `Maximum ${MAX_DOCUMENTS_PER_USER} documents allowed. Delete some to upload more.`,
      });
    }

    const id = crypto.randomUUID();
    const documentId = crypto.randomUUID();

    db.prepare(
      `INSERT INTO voice_processing_queue (id, account_id, document_id, status, created_at)
       VALUES (?, ?, ?, 'pending', datetime('now'))`
    ).run(id, accountId, documentId);

    const document = db.prepare(
      'SELECT id, document_id, status, created_at FROM voice_processing_queue WHERE id = ?'
    ).get(id);

    console.log(`[Voice] Document ${id} saved (queue not available)`);

    res.json({ success: true, document, jobId: null });
  } catch (error) {
    console.error('[Voice] Failed to upload document:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

/**
 * POST /api/voice/test
 * Test drive a response with current voice settings
 */
router.post('/test', (req, res: Response) => {
  try {
    const { originalPost, replyText, classification } = req.body;

    if (!originalPost || !replyText) {
      return res.status(400).json({
        error: 'originalPost and replyText required',
      });
    }

    res.json({
      success: true,
      response: `[Test mode] Would generate ${classification || 'neutral'} response to: "${replyText.substring(0, 50)}..."`,
      note: 'Connect voice processor worker for live responses',
    });
  } catch (error) {
    console.error('[Voice] Failed to test response:', error);
    res.status(500).json({ error: 'Failed to test response' });
  }
});

export default router;
