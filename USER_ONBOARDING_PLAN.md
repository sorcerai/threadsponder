# User Onboarding & Auth Implementation Plan

**Objective:** Create a frictionless onboarding flow that converts a new Clerk signup into an active Threadsponder user with a connected Threads account, while enforcing enterprise-grade security and privacy standards.

---

## 0. Already Implemented (Do Not Duplicate)

> **Note from deployment agent:** The following components are already built and working.

### Clerk Webhook - `packages/api/src/routes/webhooks/clerk.ts`
- Handles `user.created`, `user.updated`, `user.deleted` events
- Proactively creates account in Supabase `accounts` table (no lazy creation needed)
- Welcome email auto-sends on signup via `sendWelcomeEmail()`
- Registered at `/api/webhooks/clerk`

### Email Service - `packages/api/src/services/email-service.ts`
```typescript
// Available functions:
sendWelcomeEmail(email: string, name: string)           // Already wired to Clerk webhook
sendSubscriptionEmail(email, 'trial'|'active'|'cancelled'|'expiring')
sendEODReportEmail(email, { date, repliesHandled, hatersDeflected, minutesSaved })
sendAlertEmail(email, { type, title, message, actionUrl? })
```

### Auth Middleware - `packages/api/src/middleware/auth.ts`
```typescript
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

// Usage in routes:
router.get('/protected', authMiddleware, (req: AuthenticatedRequest, res) => {
  const { userId, accountId } = req.auth;  // Clerk user ID + Supabase account ID
});
```

### Supabase `accounts` Table Schema
| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `clerk_user_id` | TEXT | Clerk user ID |
| `name` | TEXT | Display name |
| `email` | TEXT | Primary email |
| `subscription_status` | TEXT | `trial`, `active`, `cancelled`, `deleted` |
| `subscription_ends_at` | TIMESTAMPTZ | Trial/subscription expiry |

### Environment Variables (Already Defined)
Use `ENCRYPTION_KEY` (not `THREADS_TOKEN_SECRET`) - current code expects this name.

---

## P0 Security Fix Required

**OAuth CSRF Protection Missing** - `packages/api/src/routes/auth.ts`
- Line 44: No `state` parameter generated for OAuth URL
- Line 93: No validation of state on callback

**Fix Required:**
1. Generate cryptographic state token
2. Store in Redis with 5-10min TTL: `oauth:state:{token}` → `{ accountId, exp }`
3. Validate and delete state on callback

---

## 1. Security & Privacy First
*As requested: "Production-ready infra with zero data retention"*

### Data Protection
*   **At Rest:** All sensitive tokens (Threads Access Tokens) are encrypted using **AES-256-GCM** (Galois/Counter Mode) with AAD (Additional Authenticated Data) linked to the `account_id`.
    *   *Why GCM?* It provides both confidentiality and integrity assurance.
*   **In Transit:** TLS 1.3 for all connections.
*   **LLM Privacy:** We explicitly configure inference calls (via OpenRouter/Vertex) with **Zero Data Retention** policies where available. No customer data is used to train base models.

### PII Protection
*   **Logging:** Middleware will scrub PII (emails, tokens, user IDs) from server logs before transport.
*   **CI Enforcement:** (Future) Add `detect-secrets` or similar to CI/CD pipeline to prevent accidental commit of env vars.

---

## 2. Auth Architecture

We deal with two distinct authentication layers:
1.  **User Authentication (SaaS):** Handled by **Clerk**. Identifies the human user.
2.  **Platform Authentication (Agent):** Handled by **Threads OAuth**. authorizes our agent to post on behalf of the user.

### The "Connect Threads" Flow
**Required Scopes:**
- `threads_basic` (Read profile)
- `threads_content_publish` (Post replies)
- `threads_manage_replies` (Read/Hide replies)

---

## 3. Implementation Steps

### Phase A: Backend (API) - OAuth Handling

**1. Environment Variables**
```bash
THREADS_APP_ID=your_app_id
THREADS_APP_SECRET=your_app_secret
THREADS_REDIRECT_URI=https://api.threadsponder.com/auth/threads/callback
THREADS_TOKEN_SECRET=32_char_hex_string_for_aes_256_gcm
```

**2. Security Utility (`shared/src/crypto.ts`)**
*   `encrypt(text: string, aad: string): string` -> returns `iv:authTag:ciphertext`
*   `decrypt(hash: string, aad: string): string`

**3. API Routes (`api/src/routes/auth.ts`)**

*   **`GET /auth/threads/login`**
    *   Generates a cryptographically secure `state`.
    *   Stores state in Redis with TTL (10m).
    *   Redirects to Threads OAuth dialog.

*   **`GET /auth/threads/callback`**
    *   Validates `state` and `account_id`.
    *   Exchanges code for **Long-Lived Token** (60-day validity).
    *   **Encrypts** token using `THREADS_TOKEN_SECRET`.
    *   Upserts to `threads_accounts` table.
    *   Redirects to Dashboard Onboarding.

---

### Phase B: Frontend (Dashboard) - Onboarding Wizard

**Route Guard:** Redirects to `/onboarding` if `threads_connected === false`.

**Step 1: Connect Identity**
*   "Connect Threads" button (Meta branding).
*   Displays permission explanation (We only reply to people who reply to you).

**Step 2: Persona Configuration**
*   Select from Archetypes (Savage, Hype, Chill).
*   **Voice Training:** (Optional) "Analyze my last 10 posts" button to auto-select archetype.

**Step 3: Analytics & Activation**
*   Activate Agent.
*   Setup **Product Usage Analytics** (PostHog/Fathom) to track:
    *   `replies_generated`
    *   `token_usage`
    *   `sentiment_breakdown`

---

## 4. Growth Stack (Marketing Site)

To support the "Marketing site with programmatic SEO" requirement:

**Architecture:**
*   **Framework:** Next.js (SSG/ISR).
*   **Content Strategy:** Programmatic pages targeting "How to auto-reply on [Niche] Threads".
    *   `/use-cases/real-estate-threads-bot`
    *   `/use-cases/tech-twitter-migration`
*   **CMS:** Sanity or Supabase Headless.

---

## 5. Critical Considerations

1.  **Token Refresh Strategy:**
    *   Cron job runs daily.
    *   Finds tokens expiring in < 7 days.
    *   Hits `refresh_access_token` endpoint.
    *   Re-encrypts and updates DB.

2.  **Rate Limits:**
    *   Threads API has strict rate limits.
    *   We must implement a **Token Bucket** limiter in Redis per `threads_user_id`.

3.  **Meta App Review:**
    *   **Immediate Action:** Add your personal Threads account as a "Tester" in Meta Developers to bypass review during dev.

---

## 6. Next Steps

1.  [ ] Create Meta App & get App ID/Secret.
2.  [ ] Implement `shared/src/crypto.ts` (AES-256-GCM).
3.  [ ] Build `api/src/routes/auth.ts`.
4.  [ ] Scaffold Marketing Site (separate repo or monorepo package).
