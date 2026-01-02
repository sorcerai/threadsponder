/**
 * Billing Routes
 *
 * Stripe subscription management
 */

import express, { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { AuthenticatedRequest } from '../middleware/auth.js';

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || ''; // Monthly price
const STRIPE_TRIAL_PRICE_ID = process.env.STRIPE_TRIAL_PRICE_ID || ''; // $1 trial price
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const stripe = new Stripe(STRIPE_SECRET_KEY);

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

/**
 * GET /api/billing/status
 * Get current subscription status
 */
router.get('/status', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data: account, error } = await getSupabase()
      .from('accounts')
      .select('subscription_status, subscription_ends_at, stripe_customer_id')
      .eq('id', accountId)
      .single();

    if (error) throw error;

    const now = new Date();
    const endsAt = account.subscription_ends_at
      ? new Date(account.subscription_ends_at)
      : null;

    let status = account.subscription_status;
    let daysRemaining = 0;

    if (endsAt) {
      daysRemaining = Math.max(
        0,
        Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );

      // Check if expired
      if (endsAt < now && status !== 'expired') {
        status = 'expired';
        // Update in database
        await getSupabase()
          .from('accounts')
          .update({ subscription_status: 'expired' })
          .eq('id', accountId);
      }
    }

    res.json({
      status,
      endsAt: account.subscription_ends_at,
      daysRemaining,
      hasStripeCustomer: !!account.stripe_customer_id,
    });
  } catch (error) {
    console.error('[Billing] Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
});

/**
 * POST /api/billing/checkout/trial
 * Create Stripe checkout session for $1 trial
 */
router.post('/checkout/trial', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data: account, error } = await getSupabase()
      .from('accounts')
      .select('email, stripe_customer_id, subscription_status')
      .eq('id', accountId)
      .single();

    if (error) throw error;

    // Don't allow trial if already subscribed
    if (account.subscription_status === 'active') {
      return res.status(400).json({ error: 'Already subscribed' });
    }

    // Get or create Stripe customer
    let customerId = account.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email,
        metadata: { accountId },
      });
      customerId = customer.id;

      await getSupabase()
        .from('accounts')
        .update({ stripe_customer_id: customerId })
        .eq('id', accountId);
    }

    // Create checkout session for $1 trial
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: STRIPE_TRIAL_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${APP_URL}/dashboard?trial=success`,
      cancel_url: `${APP_URL}/pricing?cancelled=true`,
      metadata: {
        accountId,
        type: 'trial',
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('[Billing] Failed to create trial checkout:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/billing/checkout/subscribe
 * Create Stripe checkout session for monthly subscription
 */
router.post('/checkout/subscribe', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data: account, error } = await getSupabase()
      .from('accounts')
      .select('email, stripe_customer_id')
      .eq('id', accountId)
      .single();

    if (error) throw error;

    // Get or create Stripe customer
    let customerId = account.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email,
        metadata: { accountId },
      });
      customerId = customer.id;

      await getSupabase()
        .from('accounts')
        .update({ stripe_customer_id: customerId })
        .eq('id', accountId);
    }

    // Create checkout session for subscription
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${APP_URL}/dashboard?subscribed=success`,
      cancel_url: `${APP_URL}/pricing?cancelled=true`,
      metadata: {
        accountId,
        type: 'subscription',
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('[Billing] Failed to create subscription checkout:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/billing/portal
 * Create Stripe billing portal session
 */
router.post('/portal', async (req, res: Response) => {
  try {
    const { accountId } = (req as unknown as AuthenticatedRequest).auth;

    const { data: account, error } = await getSupabase()
      .from('accounts')
      .select('stripe_customer_id')
      .eq('id', accountId)
      .single();

    if (error) throw error;

    if (!account.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripe_customer_id,
      return_url: `${APP_URL}/dashboard/settings/billing`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('[Billing] Failed to create portal session:', error);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

/**
 * POST /api/billing/webhook
 * Handle Stripe webhooks
 */
router.post(
  '/webhook',
  // Need raw body for signature verification
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(
        req.body, // Must be raw body
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('[Billing] Webhook signature verification failed:', err);
      return res.status(400).send('Webhook signature verification failed');
    }

    console.log(`[Billing] Received webhook: ${event.type}`);

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const accountId = session.metadata?.accountId;
          const type = session.metadata?.type;

          if (!accountId) break;

          if (type === 'trial') {
            // Activate 3-day trial
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 3);

            await getSupabase()
              .from('accounts')
              .update({
                subscription_status: 'trial',
                subscription_ends_at: trialEnd.toISOString(),
              })
              .eq('id', accountId);

            console.log(`[Billing] Trial activated for ${accountId}`);
          } else if (type === 'subscription') {
            // Subscription will be handled by invoice.paid event
            console.log(`[Billing] Subscription checkout completed for ${accountId}`);
          }
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId = invoice.customer as string;

          // Find account by Stripe customer ID
          const { data: account } = await getSupabase()
            .from('accounts')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (account) {
            // Calculate subscription end (1 month from now)
            const subscriptionEnd = new Date();
            subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);

            await getSupabase()
              .from('accounts')
              .update({
                subscription_status: 'active',
                subscription_ends_at: subscriptionEnd.toISOString(),
              })
              .eq('id', account.id);

            console.log(`[Billing] Subscription renewed for ${account.id}`);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId = invoice.customer as string;

          const { data: account } = await getSupabase()
            .from('accounts')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (account) {
            // Don't immediately cancel, just log - Stripe will retry
            console.log(`[Billing] Payment failed for ${account.id}`);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          const { data: account } = await getSupabase()
            .from('accounts')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (account) {
            await getSupabase()
              .from('accounts')
              .update({
                subscription_status: 'cancelled',
              })
              .eq('id', account.id);

            console.log(`[Billing] Subscription cancelled for ${account.id}`);
          }
          break;
        }

        default:
          console.log(`[Billing] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[Billing] Webhook handling error:', error);
      res.status(500).json({ error: 'Webhook handling failed' });
    }
  }
);

export default router;
