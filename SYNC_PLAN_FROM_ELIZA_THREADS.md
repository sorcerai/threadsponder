# Feature Sync Plan: eliza-threads → threadsponder

**Source**: `/Users/ariapramesi/repos/eliza-threads/agent/src/`
**Target**: `/Users/ariapramesi/repos/threadsponder/packages/workers/src/`
**Purpose**: Achieve feature parity before breaking off into independent projects

---

## Executive Summary

| Priority | Feature | Status | Effort |
|----------|---------|--------|--------|
| 🔴 P0 | InsecurityProvider ("Loser Dossier") | MISSING | Medium |
| 🔴 P0 | Attack Vector Injection | MISSING | Small |
| 🟡 P1 | Bot-loop Provider | MISSING | Small |
| 🟡 P1 | Evaluators System | MISSING | Medium |
| 🟢 P2 | Vision Classifier | MISSING | Small |
| ✅ | Voice Style Analysis | ALIGNED | - |
| ✅ | Friends System | ALIGNED (diff backend) | - |
| ✅ | Meta-comment Detection | ALIGNED | - |

---

## 🔴 P0: CRITICAL - InsecurityProvider

### Source File
`eliza-threads/agent/src/providers/insecurity-provider.ts` (286 lines)

### Target Location
`threadsponder/packages/workers/src/utils/insecurity-provider.ts`

### What It Does
Tracks user behavior patterns to identify psychological vulnerabilities ("Loser Dossier"):
- **DESPERATE**: Reply latency < 60s = "chronically online"
- **JOBLESS**: Multiple fast replies = "you have free time"
- **YAPPER**: Messages > 200 chars = "essay writer"
- **FAN**: 5+ total replies = "obsessed fan"
- **NORMIE**: Default baseline

### Key Interfaces to Port
```typescript
export type Archetype = 'DESPERATE' | 'JOBLESS' | 'YAPPER' | 'FAN' | 'NORMIE';

export interface AttackVector {
  archetype: Archetype;
  data: string;
  prompt: string;
}

export interface DossierStats {
  replyCount: number;
  fastReplies: number;
  longMessages: number;
  firstSeen: number;
  lastSeen: number;
  archetype: Archetype;
}
```

### Adaptation Required
- Replace DragonflyDB calls with Supabase
- Add `account_id` field for multi-tenant support
- Create new table: `user_dossiers`

### SQL Migration
```sql
CREATE TABLE user_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  user_id TEXT NOT NULL,
  reply_count INTEGER DEFAULT 0,
  fast_replies INTEGER DEFAULT 0,
  long_messages INTEGER DEFAULT 0,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  archetype TEXT DEFAULT 'NORMIE',
  UNIQUE(account_id, user_id)
);
CREATE INDEX idx_dossiers_account ON user_dossiers(account_id);
```

---

## 🔴 P0: CRITICAL - Attack Vector Injection

### Source File
`eliza-threads/agent/src/utils/smart-responder.ts` lines 400-420

### Target File
`threadsponder/packages/workers/src/utils/responder.ts`

### What's Missing
The `ResponseContext` interface needs `attackVector` field:

```typescript
// ADD to ResponseContext interface
export interface ResponseContext {
  // ... existing fields ...
  attackVector?: AttackVector | null;  // ADD THIS
}
```

### Integration Point
In `generateResponse()`, inject attack vector into hostile prompts:

```typescript
// ADD before prompt construction (around line 220)
let contextAdditions = '';
if (ctx.classification === 'hostile' && ctx.attackVector?.archetype !== 'NORMIE') {
  contextAdditions = `\n${ctx.attackVector.prompt}\n`;
}

// MODIFY toneInstructions['hostile'] to include:
// ${contextAdditions}
```

---

## 🟡 P1: Bot-loop Provider

### Source File
`eliza-threads/agent/src/evaluators/bot-loop.ts` (10602 bytes)

### Target Location
`threadsponder/packages/workers/src/utils/bot-loop-detector.ts`

### What It Does
3-layer bot detection preventing infinite bot-to-bot replies:
1. Username pattern matching (`*bot*`, `*ai*`, `*auto*`)
2. Response timing analysis (< 2s = suspicious)
3. Content pattern detection (templated responses)

### Key Function
```typescript
export async function detectBotLoop(
  username: string,
  replyText: string,
  replyLatencyMs: number
): Promise<{ isBot: boolean; confidence: number; reason: string }>
```

### Adaptation
- Works standalone, no database changes needed
- Import into responder pipeline

---

## 🟡 P1: Evaluators System

### Source Directory
`eliza-threads/agent/src/evaluators/`
- `bot-loop.ts` (10602 bytes)
- `engagement-tracker.ts` (8576 bytes)
- `should-reply.ts` (5108 bytes)
- `index.ts` (3948 bytes)

### Target Directory
`threadsponder/packages/workers/src/evaluators/`

### What It Does
Pre-response evaluation pipeline:
- **should-reply**: Rate limiting, cooldowns, worthiness checks
- **engagement-tracker**: Track reply success/failure for learning
- **bot-loop**: Bot detection (covered above)
- **index**: Exports and orchestration

### Adaptation
- Add multi-tenant support via `account_id`
- Replace Redis calls with Supabase where persistent
- Keep in-memory for rate limiting

---

## 🟢 P2: Vision Classifier

### Source File
`eliza-threads/agent/src/utils/vision-classifier.ts`

### Target Location
`threadsponder/packages/workers/src/utils/vision-classifier.ts`

### What It Does
Classifies image attachments in replies:
- Meme detection
- Screenshot detection
- Profile picture analysis

### Adaptation
- Direct port, no changes needed
- Uses OpenRouter vision API

---

## Already Aligned (No Action)

### Voice Style Analysis
- Source: `smart-responder.ts` lines 50-150
- Target: `responder.ts` lines 51-100
- Status: ✅ Identical implementation

### Friends System
- Source: `friends-provider.ts` (DragonflyDB)
- Target: `routes/friends.ts` (Supabase)
- Status: ✅ Same concept, different backend - KEEP AS IS

### Meta-comment Detection
- Source: `smart-responder.ts` `isMetaComment()`
- Target: `fast-classifier.ts` `isMetaComment()`
- Status: ✅ Already ported

---

## Implementation Order

### Phase 1: Core Attack System (P0)
1. Create `user_dossiers` table migration
2. Port `insecurity-provider.ts` with Supabase adapter
3. Add `attackVector` to `ResponseContext`
4. Integrate attack vector injection in `generateResponse()`

### Phase 2: Evaluation Pipeline (P1)
5. Create `evaluators/` directory
6. Port `bot-loop.ts`
7. Port `should-reply.ts`
8. Port `engagement-tracker.ts`
9. Create `evaluators/index.ts` orchestrator

### Phase 3: Enhancement (P2)
10. Port `vision-classifier.ts`
11. Add image classification to worker pipeline

---

## Testing Checklist

- [ ] InsecurityProvider tracks behavior correctly
- [ ] Attack vectors generate appropriate prompts
- [ ] Bot-loop detection prevents infinite loops
- [ ] Should-reply respects rate limits
- [ ] Vision classifier handles images
- [ ] Multi-tenant isolation maintained
- [ ] No regressions in existing features

---

## Files to Create

```
threadsponder/packages/workers/src/
├── utils/
│   ├── insecurity-provider.ts   # NEW
│   ├── bot-loop-detector.ts     # NEW
│   └── vision-classifier.ts     # NEW
├── evaluators/                   # NEW DIRECTORY
│   ├── index.ts
│   ├── bot-loop.ts
│   ├── should-reply.ts
│   └── engagement-tracker.ts
└── migrations/
    └── 003_user_dossiers.sql    # NEW
```

## Files to Modify

```
threadsponder/packages/workers/src/utils/responder.ts
  - Add attackVector to ResponseContext
  - Integrate attack vector injection

threadsponder/packages/shared/src/types.ts
  - Add Archetype, AttackVector types
```
