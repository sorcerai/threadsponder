/**
 * Billing Routes
 *
 * Subscription status (SQLite backend). Stripe flows not available in standalone mode.
 */

import express, { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { getDb } from '@threadsponder/shared';

const router: Router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Lazy init Stripe
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    if (!STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/**
 * GET /api/billing/status
 * Get current subscription status
 */
router.get('/status', (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;
    const db = getDb();

    const account = db.prepare(
      'SELECT subscription_status, subscription_ends_at FROM accounts WHERE id = ?'
    ).get(accountId) as { subscription_status: string; subscription_ends_at: string | null } | undefined;

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const now = new Date();
    const endsAt = account.subscription_ends_at ? new Date(account.subscription_ends_at) : null;
    let status = account.subscription_status;
    let daysRemaining = 0;

    if (endsAt) {
      daysRemaining = Math.max(
        0,
        Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );

      if (endsAt < now && status !== 'expired') {
        status = 'expired';
        db.prepare('UPDATE accounts SET subscription_status = ? WHERE id = ?').run('expired', accountId);
      }
    }

    res.json({
      status,
      endsAt: account.subscription_ends_at,
      daysRemaining,
      hasStripeCustomer: false,
    });
  } catch (error) {
    console.error('[Billing] Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

/**
 * POST /api/billing/checkout/trial
 * Not available in standalone mode
 */
router.post('/checkout/trial', (_req, res: Response) => {
  res.status(501).json({ error: 'Billing not available in standalone mode' });
});

/**
 * POST /api/billing/checkout/subscribe
 * Not available in standalone mode
 */
router.post('/checkout/subscribe', (_req, res: Response) => {
  res.status(501).json({ error: 'Billing not available in standalone mode' });
});

/**
 * POST /api/billing/portal
 * Not available in standalone mode
 */
router.post('/portal', (_req, res: Response) => {
  res.status(501).json({ error: 'Billing not available in standalone mode' });
});

export default router;

/**
 * Stripe webhook handler - exported separately for raw body mounting
 */
export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const sig = req.headers['stripe-signature'] as string;

  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn('[Billing] STRIPE_WEBHOOK_SECRET not configured');
    res.json({ received: true });
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Billing] Webhook signature verification failed:', err);
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  console.log(`[Billing] Received webhook: ${event.type}`);

  try {
    // accounts table has no stripe_customer_id column in SQLite schema
    // Only handle checkout.session.completed where we have accountId in metadata
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const accountId = session.metadata?.accountId;
      const type = session.metadata?.type;

      if (accountId && type === 'trial') {
        const db = getDb();
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 3);

        db.prepare(
          'UPDATE accounts SET subscription_status = ?, subscription_ends_at = ? WHERE id = ?'
        ).run('trial', trialEnd.toISOString(), accountId);

        console.log(`[Billing] Trial activated for ${accountId}`);
      }
    } else {
      console.log(`[Billing] Webhook ${event.type} logged (no stripe_customer_id column for lookup)`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('[Billing] Webhook handling error:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
}
