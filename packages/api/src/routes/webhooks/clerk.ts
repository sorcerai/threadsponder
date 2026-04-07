/**
 * Clerk Webhook Handler (SQLite backend)
 *
 * Syncs Clerk user events to the local SQLite accounts table.
 * Events: user.created, user.updated, user.deleted
 *
 * Note: In standalone/open-source mode this webhook is optional —
 * auth middleware auto-creates accounts on first request.
 */

import express, { Request, Response, Router } from 'express';
import { Webhook } from 'svix';
import { getDb } from '@threadsponder/shared';
import { sendWelcomeEmail } from '../../services/email-service.js';

const router: Router = express.Router();

const CLERK_WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET || '';

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

function getPrimaryEmail(data: ClerkUserData): string {
  if (!data.email_addresses || data.email_addresses.length === 0) {
    return '';
  }
  if (data.primary_email_address_id) {
    const primary = data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id
    );
    if (primary) return primary.email_address;
  }
  return data.email_addresses[0]?.email_address || '';
}

function getDisplayName(data: ClerkUserData): string {
  const firstName = data.first_name || '';
  const lastName = data.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || 'User';
}

function createAccount(data: ClerkUserData): void {
  const db = getDb();

  const existing = db.prepare(
    'SELECT id FROM accounts WHERE user_id = ?'
  ).get(data.id);

  if (existing) {
    console.log(`[Clerk Webhook] Account already exists for ${data.id}`);
    return;
  }

  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + 3);

  db.prepare(
    `INSERT INTO accounts (user_id, name, email, subscription_status, subscription_ends_at)
     VALUES (?, ?, ?, 'trial', ?)`
  ).run(data.id, getDisplayName(data), getPrimaryEmail(data), trialEnd.toISOString());

  console.log(`[Clerk Webhook] Created account for ${data.id}`);
}

function updateAccount(data: ClerkUserData): void {
  const db = getDb();

  db.prepare(
    'UPDATE accounts SET name = ?, email = ?, updated_at = datetime(\'now\') WHERE user_id = ?'
  ).run(getDisplayName(data), getPrimaryEmail(data), data.id);

  console.log(`[Clerk Webhook] Updated account for ${data.id}`);
}

function deactivateAccount(clerkUserId: string): void {
  const db = getDb();

  db.prepare(
    "UPDATE accounts SET subscription_status = 'deleted', updated_at = datetime('now') WHERE user_id = ?"
  ).run(clerkUserId);

  console.log(`[Clerk Webhook] Deactivated account for ${clerkUserId}`);
}

/**
 * POST /api/webhooks/clerk
 * Handle Clerk webhook events
 */
router.post('/', (req: Request, res: Response) => {
  if (!CLERK_WEBHOOK_SECRET) {
    console.error('[Clerk Webhook] CLERK_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    return res.status(400).json({ error: 'Missing webhook headers' });
  }

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
      case 'user.created': {
        createAccount(event.data);
        const email = getPrimaryEmail(event.data);
        const name = getDisplayName(event.data);
        if (email) {
          sendWelcomeEmail(email, name).catch((err) => {
            console.error('[Clerk Webhook] Failed to send welcome email:', err);
          });
        }
        break;
      }
      case 'user.updated':
        updateAccount(event.data);
        break;
      case 'user.deleted':
        deactivateAccount(event.data.id);
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
