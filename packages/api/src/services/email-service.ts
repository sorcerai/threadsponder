/**
 * Email Service - Resend Integration
 *
 * Transactional email delivery for:
 * - Welcome emails (on account creation)
 * - Subscription confirmations (trial, active, cancelled)
 * - EOD report delivery
 * - Alert notifications
 */

import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Threadsponder <noreply@threadsponder.com>';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://app.threadsponder.com';

// Initialize Resend client (lazy - only when needed)
let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    if (!RESEND_API_KEY) {
      throw new Error('[Email] RESEND_API_KEY not configured');
    }
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailResult {
  id: string;
  success: boolean;
}

/**
 * Send transactional email via Resend
 */
export async function sendEmail(options: EmailOptions): Promise<EmailResult> {
  try {
    const resend = getResend();

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    if (error) {
      console.error('[Email] Failed to send:', error);
      throw error;
    }

    console.log(`[Email] Sent to ${options.to}: ${data?.id}`);
    return { id: data?.id || '', success: true };
  } catch (error) {
    console.error('[Email] Send error:', error);
    return { id: '', success: false };
  }
}

/**
 * Send welcome email on account creation
 */
export async function sendWelcomeEmail(
  email: string,
  name: string
): Promise<EmailResult> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a1a;">Welcome to Threadsponder, ${name}!</h1>

  <p>Your 3-day trial has started. Here's what you can do:</p>

  <ul style="padding-left: 20px;">
    <li><strong>Connect your Threads account</strong> - Link your profile to start monitoring</li>
    <li><strong>Set up focus mode</strong> - Choose which posts to monitor for replies</li>
    <li><strong>Train your AI voice</strong> - Customize how your auto-replies sound</li>
  </ul>

  <p style="margin-top: 30px;">
    <a href="${DASHBOARD_URL}/dashboard" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      Go to Dashboard
    </a>
  </p>

  <p style="margin-top: 30px; color: #666; font-size: 14px;">
    Questions? Just reply to this email.
  </p>
</body>
</html>
  `.trim();

  const text = `Welcome to Threadsponder, ${name}!

Your 3-day trial has started. Here's what you can do:

- Connect your Threads account - Link your profile to start monitoring
- Set up focus mode - Choose which posts to monitor for replies
- Train your AI voice - Customize how your auto-replies sound

Go to Dashboard: ${DASHBOARD_URL}/dashboard

Questions? Just reply to this email.`;

  return sendEmail({
    to: email,
    subject: 'Welcome to Threadsponder!',
    html,
    text,
  });
}

/**
 * Send subscription status email
 */
export async function sendSubscriptionEmail(
  email: string,
  type: 'trial' | 'active' | 'cancelled' | 'expiring'
): Promise<EmailResult> {
  const content = {
    trial: {
      subject: 'Your trial has started!',
      heading: 'Your 3-day trial is active',
      message:
        'You have 3 days to try all of Threadsponder\'s features. After your trial, you can subscribe to continue using the service.',
      cta: 'Explore Features',
      ctaUrl: `${DASHBOARD_URL}/dashboard`,
    },
    active: {
      subject: 'Subscription confirmed',
      heading: 'Thank you for subscribing!',
      message:
        'Your Threadsponder subscription is now active. You have unlimited access to all features.',
      cta: 'Go to Dashboard',
      ctaUrl: `${DASHBOARD_URL}/dashboard`,
    },
    cancelled: {
      subject: 'Subscription cancelled',
      heading: 'Your subscription has been cancelled',
      message:
        'Your Threadsponder subscription has been cancelled. You can resubscribe anytime to regain access.',
      cta: 'Resubscribe',
      ctaUrl: `${DASHBOARD_URL}/billing`,
    },
    expiring: {
      subject: 'Your trial expires tomorrow',
      heading: 'Your trial ends tomorrow',
      message:
        'Your Threadsponder trial expires in 24 hours. Subscribe now to keep your automated replies running.',
      cta: 'Subscribe Now',
      ctaUrl: `${DASHBOARD_URL}/billing`,
    },
  };

  const { subject, heading, message, cta, ctaUrl } = content[type];

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a1a;">${heading}</h1>

  <p>${message}</p>

  <p style="margin-top: 30px;">
    <a href="${ctaUrl}" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      ${cta}
    </a>
  </p>
</body>
</html>
  `.trim();

  const text = `${heading}\n\n${message}\n\n${cta}: ${ctaUrl}`;

  return sendEmail({
    to: email,
    subject,
    html,
    text,
  });
}

/**
 * Send EOD report email
 */
export async function sendEODReportEmail(
  email: string,
  report: {
    date: string;
    repliesHandled: number;
    hatersDeflected: number;
    minutesSaved: number;
  }
): Promise<EmailResult> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a1a;">Daily Report: ${report.date}</h1>

  <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #ddd;">
          <strong>Replies Handled</strong>
        </td>
        <td style="padding: 10px 0; border-bottom: 1px solid #ddd; text-align: right; font-size: 24px; color: #0070f3;">
          ${report.repliesHandled}
        </td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #ddd;">
          <strong>Haters Deflected</strong>
        </td>
        <td style="padding: 10px 0; border-bottom: 1px solid #ddd; text-align: right; font-size: 24px; color: #e53e3e;">
          ${report.hatersDeflected}
        </td>
      </tr>
      <tr>
        <td style="padding: 10px 0;">
          <strong>Minutes Saved</strong>
        </td>
        <td style="padding: 10px 0; text-align: right; font-size: 24px; color: #38a169;">
          ${report.minutesSaved}
        </td>
      </tr>
    </table>
  </div>

  <p style="margin-top: 30px;">
    <a href="${DASHBOARD_URL}/reports" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      View Full Report
    </a>
  </p>
</body>
</html>
  `.trim();

  const text = `Daily Report: ${report.date}

Replies Handled: ${report.repliesHandled}
Haters Deflected: ${report.hatersDeflected}
Minutes Saved: ${report.minutesSaved}

View Full Report: ${DASHBOARD_URL}/reports`;

  return sendEmail({
    to: email,
    subject: `Daily Report: ${report.date} - ${report.repliesHandled} replies handled`,
    html,
    text,
  });
}

/**
 * Send alert notification
 */
export async function sendAlertEmail(
  email: string,
  alert: {
    type: 'high_volume' | 'hostile_spike' | 'error';
    title: string;
    message: string;
    actionUrl?: string;
  }
): Promise<EmailResult> {
  const colors = {
    high_volume: '#f59e0b',
    hostile_spike: '#e53e3e',
    error: '#dc2626',
  };

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${colors[alert.type]}; padding-left: 16px;">
    <h1 style="color: #1a1a1a; margin: 0 0 10px 0;">${alert.title}</h1>
    <p style="margin: 0; color: #666;">${alert.message}</p>
  </div>

  ${
    alert.actionUrl
      ? `
  <p style="margin-top: 30px;">
    <a href="${alert.actionUrl}" style="display: inline-block; background: #0070f3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">
      View Details
    </a>
  </p>
  `
      : ''
  }
</body>
</html>
  `.trim();

  const text = `${alert.title}\n\n${alert.message}${alert.actionUrl ? `\n\nView Details: ${alert.actionUrl}` : ''}`;

  return sendEmail({
    to: email,
    subject: `[Alert] ${alert.title}`,
    html,
    text,
  });
}
