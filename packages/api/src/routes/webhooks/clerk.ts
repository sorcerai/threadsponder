/**
 * Clerk Webhook Handler
 *
 * Proactively syncs Clerk user events to Supabase accounts table.
 * Events: user.created, user.updated, user.deleted
 *
 * This replaces lazy account creation with proactive sync,
 * ensuring users exist in Supabase immediately after Clerk signup.
 */

import express, { Request, Response, Router } from 'express';
import { Webhook } from 'svix';
import { createClient } from '@supabase/supabase-js';
import { sendWelcomeEmail } from '../../services/email-service.js';

const router: Router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

interface ClerkUserData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email_addresses: Array<{
    id: string;
    email_address: string;
    verification: { status: string } | null;
  }>;
  primary_email_address_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}

/**
 * Get primary email from Clerk user data
 */
function getPrimaryEmail(data: ClerkUserData): string {
  if (!data.email_addresses || data.email_addresses.length === 0) {
    return '';
  }

  // Find primary email
  if (data.primary_email_address_id) {
    const primary = data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id
    );
    if (primary) return primary.email_address;
  }

  // Fall back to first email
  return data.email_addresses[0]?.email_address || '';
}

/**
 * Get display name from Clerk user data
 */
function getDisplayName(data: ClerkUserData): string {
  const firstName = data.first_name || '';
  const lastName = data.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || 'User';
}

/**
 * Create account in Supabase when user signs up in Clerk
 */
async function createAccount(data: ClerkUserData): Promise<void> {
  const supabase = getSupabase();

  // Check if account already exists (idempotency)
  const { data: existing } = await supabase
    .from('accounts')
    .select('id')
    .eq('clerk_user_id', data.id)
    .single();

  if (existing) {
    console.log(`[Clerk Webhook] Account already exists for ${data.id}`);
    return;
  }

  // Create new account with 3-day trial
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 3);

  const { error } = await supabase.from('accounts').insert({
    clerk_user_id: data.id,
    name: getDisplayName(data),
    email: getPrimaryEmail(data),
    subscription_status: 'trial',
    subscription_ends_at: trialEnd.toISOString(),
  });

  if (error) {
    console.error('[Clerk Webhook] Failed to create account:', error);
    throw error;
  }

  console.log(`[Clerk Webhook] Created account for ${data.id}`);
}

/**
 * Update account when user profile changes in Clerk
 */
async function updateAccount(data: ClerkUserData): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('accounts')
    .update({
      name: getDisplayName(data),
      email: getPrimaryEmail(data),
      updated_at: new Date().toISOString(),
    })
    .eq('clerk_user_id', data.id);

  if (error) {
    console.error('[Clerk Webhook] Failed to update account:', error);
    throw error;
  }

  console.log(`[Clerk Webhook] Updated account for ${data.id}`);
}

/**
 * Deactivate account when user is deleted from Clerk
 * Soft delete - marks account as deleted but preserves data
 */
async function deactivateAccount(clerkUserId: string): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('accounts')
    .update({
      subscription_status: 'deleted',
      updated_at: new Date().toISOString(),
    })
    .eq('clerk_user_id', clerkUserId);

  if (error) {
    console.error('[Clerk Webhook] Failed to deactivate account:', error);
    throw error;
  }

  console.log(`[Clerk Webhook] Deactivated account for ${clerkUserId}`);
}

/**
 * POST /api/webhooks/clerk
 * Handle Clerk webhook events
 *
 * Clerk uses Svix for webhook delivery and signature verification.
 * Required headers: svix-id, svix-timestamp, svix-signature
 */
router.post('/', async (req: Request, res: Response) => {
  // Validate webhook secret is configured
  if (!CLERK_WEBHOOK_SECRET) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Extract Svix headers
  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error('[Clerk Webhook] Missing Svix headers');
    return res.status(400).json({ error: 'Missing webhook headers' });
  }

  // Verify webhook signature
  const wh = new Webhook(CLERK_WEBHOOK_SECRET);
  let event: ClerkWebhookEvent;

  try {
    event = wh.verify(JSON.stringify(req.body), {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error('[Clerk Webhook] Signature verification failed:', err);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log(`[Clerk Webhook] Received event: ${event.type}`);

  try {
    switch (event.type) {
      case 'user.created':
        await createAccount(event.data);
        // Send welcome email (non-blocking - don't fail webhook if email fails)
        const email = getPrimaryEmail(event.data);
        const name = getDisplayName(event.data);
        if (email) {
          sendWelcomeEmail(email, name).catch((err) => {
            console.error('[Clerk Webhook] Failed to send welcome email:', err);
          });
        }
        break;

      case 'user.updated':
        await updateAccount(event.data);
        break;

      case 'user.deleted':
        await deactivateAccount(event.data.id);
        break;

      default:
        console.log(`[Clerk Webhook] Unhandled event type: ${event.type}`);
    }

    return res.json({ received: true });
  } catch (error) {
    console.error('[Clerk Webhook] Event handling error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Event handling failed',
    });
  }
});

export default router;
