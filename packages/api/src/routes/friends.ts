/**
 * Friends Routes
 *
 * Manage friends list for banter/roast mode
 */

import express, { Response, Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router: Router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

const friendSchema = z.object({
  username: z.string().min(1).max(100),
  mode: z.enum(['banter', 'roast']).default('banter'),
  notes: z.string().max(500).optional(),
});

/**
 * GET /api/friends
 * List all friends
 */
router.get('/', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data, error } = await getSupabase()
      .from('friends')
      .select('*')
      .eq('account_id', accountId)
      .order('username', { ascending: true });

    if (error) throw error;

    res.json({ friends: data || [] });
  } catch (error) {
    console.error('[Friends] Failed to list friends:', error);
    res.status(500).json({ error: 'Failed to list friends' });
  }
});

/**
 * POST /api/friends
 * Add a friend
 */
router.post('/', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const parsed = friendSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { username, mode, notes } = parsed.data;

    // Normalize username (remove @ if present)
    const normalizedUsername = username.replace(/^@/, '').toLowerCase();

    const { data, error } = await getSupabase()
      .from('friends')
      .insert({
        account_id: accountId,
        username: normalizedUsername,
        mode,
        notes: notes || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Friend already exists' });
      }
      throw error;
    }

    res.json({ success: true, friend: data });
  } catch (error) {
    console.error('[Friends] Failed to add friend:', error);
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

/**
 * PUT /api/friends/:id
 * Update a friend
 */
router.put('/:id', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;
    const parsed = friendSchema.partial().safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (parsed.data.username) {
      updates.username = parsed.data.username.replace(/^@/, '').toLowerCase();
    }
    if (parsed.data.mode) {
      updates.mode = parsed.data.mode;
    }
    if (parsed.data.notes !== undefined) {
      updates.notes = parsed.data.notes || null;
    }

    const { data, error } = await getSupabase()
      .from('friends')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Friend not found' });
    }

    res.json({ success: true, friend: data });
  } catch (error) {
    console.error('[Friends] Failed to update friend:', error);
    res.status(500).json({ error: 'Failed to update friend' });
  }
});

/**
 * DELETE /api/friends/:id
 * Remove a friend
 */
router.delete('/:id', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    const { error } = await getSupabase()
      .from('friends')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('[Friends] Failed to delete friend:', error);
    res.status(500).json({ error: 'Failed to delete friend' });
  }
});

/**
 * PATCH /api/friends/:id/mode
 * Toggle friend mode (banter/roast)
 */
router.patch('/:id/mode', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const { id } = req.params;

    const { data: current } = await getSupabase()
      .from('friends')
      .select('mode')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (!current) {
      return res.status(404).json({ error: 'Friend not found' });
    }

    const newMode = current.mode === 'banter' ? 'roast' : 'banter';

    const { data, error } = await getSupabase()
      .from('friends')
      .update({ mode: newMode, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', accountId)
      .select('*')
      .single();

    if (error) throw error;

    res.json({ success: true, friend: data });
  } catch (error) {
    console.error('[Friends] Failed to toggle friend mode:', error);
    res.status(500).json({ error: 'Failed to toggle friend mode' });
  }
});

export default router;
