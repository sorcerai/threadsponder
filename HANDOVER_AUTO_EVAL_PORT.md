# Auto-Eval Feature Port: Handover Document

**Date**: January 1, 2026
**Project**: Porting auto-eval feature from eliza-threads to threadsponder
**Status**: 70% Complete

---

## Executive Summary

The goal is to achieve feature parity between `eliza-threads` and `threadsponder` for the auto-eval functionality. This feature allows AI-powered evaluation of bot replies using a 5-dimension scoring system (bloom-eval), replacing manual thumbs up/down rating.

### Progress Summary
| Task | Status | Notes |
|------|--------|-------|
| Add auto-eval types to useFineTune.ts | ✅ COMPLETE | Types and hooks added |
| Update FineTune.tsx with auto-eval UI | ⏳ IN PROGRESS | Needs Zap/Brain buttons + score grid |
| Verify backend auto-eval routes | ⏳ PENDING | Check API routes exist |

---

## Part 1: What's Been Completed

### 1.1 Auto-Eval Hooks Added to Threadsponder

**File**: `/Users/ariapramesi/repos/threadsponder/packages/dashboard/src/hooks/useFineTune.ts`

The following were added (matching eliza-threads implementation):

#### TypeScript Interfaces (Lines ~219-254)
```typescript
// Auto-eval types - bloom-eval 5-dimension scoring
export interface AutoEvalScores {
  context_match: number;      // 1-10: Does reply address actual hostile content?
  effort_asymmetry: number;   // 1-10: Is reply appropriately short (1-15 words)?
  bot_detection: number;      // 1-10: Does it sound human?
  phrase_freshness: number;   // 1-10: Avoids overused phrases?
  status_preservation: number; // 1-10: Maintains unbothered dominance?
  overall: number;            // 1-10: Weighted average
}

export interface AutoEvalResult {
  success: boolean;
  replyId: string;
  scores: AutoEvalScores;
  rating: 1 | -1;
  feedbackSaved: boolean;
  reply: {
    hostile: string;
    our: string;
    pattern: string;
    classification: string;
  };
}

export interface AutoEvalBatchResult {
  success: boolean;
  processed: number;
  errors: number;
  results: Array<{
    replyId: string;
    scores?: AutoEvalScores;
    rating?: 1 | -1;
    pattern?: string;
    error?: string;
  }>;
}
```

#### Hooks (Lines ~256-308)
```typescript
// useAutoEval() - Single reply auto-evaluation
export function useAutoEval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ replyId, saveFeedback = true }: { replyId: string; saveFeedback?: boolean }): Promise<AutoEvalResult> => {
      const res = await fetch('/api/finetune/auto-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyId, saveFeedback })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to auto-evaluate reply');
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.feedbackSaved) {
        queryClient.invalidateQueries({ queryKey: ['finetune-stats'] });
        queryClient.invalidateQueries({ queryKey: ['finetune-patterns'] });
        queryClient.invalidateQueries({ queryKey: ['finetune-unrated'] });
        queryClient.invalidateQueries({ queryKey: ['finetune-history'] });
      }
    }
  });
}

// useAutoEvalBatch() - Batch auto-evaluation
export function useAutoEvalBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ limit = 10 }: { limit?: number } = {}): Promise<AutoEvalBatchResult> => {
      const res = await fetch('/api/finetune/auto-eval-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to batch auto-evaluate');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finetune-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-patterns'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-unrated'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-history'] });
    }
  });
}
```

---

## Part 2: What Needs to Be Done

### 2.1 Update FineTune.tsx with Auto-Eval UI

**File**: `/Users/ariapramesi/repos/threadsponder/packages/dashboard/src/pages/FineTune.tsx`
**Current size**: 446 lines
**Reference implementation**: `/Users/ariapramesi/repos/eliza-threads/agent/client/src/pages/FineTune.tsx`

#### Required Changes:

##### A. Import Additions (Line ~1-24)

**Current imports:**
```typescript
import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import {
  useFineTuneStats,
  usePatternScores,
  useUnratedReplies,
  useBannedPhrases,
  useSubmitFeedback,
  useManualEval
} from '@/hooks/useFineTune';
import {
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Ban,
  Plus,
  X,
  Target,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
```

**ADD these imports:**
```typescript
// Add to useFineTune import:
import {
  useFineTuneStats,
  usePatternScores,
  useUnratedReplies,
  useBannedPhrases,
  useSubmitFeedback,
  useManualEval,
  useAutoEval,        // ADD
  useAutoEvalBatch,   // ADD
  type AutoEvalScores // ADD
} from '@/hooks/useFineTune';

// Add to lucide-react import:
import {
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  TrendingDown,
  Minus,
  Ban,
  Plus,
  X,
  Target,
  AlertTriangle,
  RefreshCw,
  Zap,    // ADD - for single auto-eval button
  Brain   // ADD - for batch auto-eval button
} from 'lucide-react';
```

##### B. State and Hook Additions (After existing state declarations)

```typescript
// Add these state variables
const [autoEvalResults, setAutoEvalResults] = useState<Record<string, AutoEvalScores>>({});
const [autoEvalInProgress, setAutoEvalInProgress] = useState<string | null>(null);
const [batchEvalInProgress, setBatchEvalInProgress] = useState(false);

// Add these hooks
const autoEval = useAutoEval();
const autoEvalBatch = useAutoEvalBatch();
```

##### C. Handler Functions (Add after existing handlers)

```typescript
// Auto-eval single reply
const handleAutoEval = async (replyId: string) => {
  setAutoEvalInProgress(replyId);
  try {
    const result = await autoEval.mutateAsync({ replyId, saveFeedback: true });
    setAutoEvalResults(prev => ({
      ...prev,
      [replyId]: result.scores
    }));
  } catch (error) {
    console.error('Auto-eval failed:', error);
  } finally {
    setAutoEvalInProgress(null);
  }
};

// Batch auto-eval all unrated
const handleBatchAutoEval = async () => {
  setBatchEvalInProgress(true);
  try {
    await autoEvalBatch.mutateAsync({ limit: 20 });
  } catch (error) {
    console.error('Batch auto-eval failed:', error);
  } finally {
    setBatchEvalInProgress(false);
  }
};

// Score color helper
const getScoreColor = (score: number): string => {
  if (score >= 8) return 'text-green-400';
  if (score >= 6) return 'text-yellow-400';
  if (score >= 4) return 'text-orange-400';
  return 'text-red-400';
};
```

##### D. Brain Button in Header (Around line 98-105)

**Current:**
```typescript
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold text-white">Fine Tune</h1>
    <p className="text-sm text-muted-foreground mt-1">
      Rate replies to improve AI Agent behavior over time
    </p>
  </div>
</div>
```

**Change to:**
```typescript
<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-bold text-white">Fine Tune</h1>
    <p className="text-sm text-muted-foreground mt-1">
      Rate replies to improve AI Agent behavior over time
    </p>
  </div>
  {/* Batch Auto-Eval Button */}
  {unratedReplies.data?.count && unratedReplies.data.count > 0 && (
    <button
      onClick={handleBatchAutoEval}
      disabled={batchEvalInProgress}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
        "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20",
        "disabled:opacity-50 disabled:cursor-not-allowed"
      )}
    >
      <Brain className={cn("w-4 h-4", batchEvalInProgress && "animate-pulse")} />
      {batchEvalInProgress ? 'Evaluating...' : `Auto-Eval All (${unratedReplies.data.count})`}
    </button>
  )}
</div>
```

##### E. Zap Button After ThumbsDown (Around line 277)

**Current (ThumbsDown button):**
```typescript
<button
  onClick={(e) => {
    e.stopPropagation();
    handleRating(reply.id, -1);
  }}
  disabled={ratingInProgress === reply.id || submitFeedback.isPending}
  className={cn(
    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-all",
    "bg-red-500/10 text-red-400 hover:bg-red-500/20",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  )}
>
  <ThumbsDown className="w-3 h-3" />
</button>
```

**Add this AFTER the ThumbsDown button:**
```typescript
{/* Auto-Eval Button (Zap) */}
<button
  onClick={(e) => {
    e.stopPropagation();
    handleAutoEval(reply.id);
  }}
  disabled={autoEvalInProgress === reply.id || autoEval.isPending}
  className={cn(
    "flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ml-2",
    "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20",
    "disabled:opacity-50 disabled:cursor-not-allowed"
  )}
  title="Auto-evaluate with AI"
>
  <Zap className={cn("w-3 h-3", autoEvalInProgress === reply.id && "animate-pulse")} />
</button>
```

##### F. Score Display Grid (Add after Zap button or in expanded reply view)

```typescript
{/* Auto-Eval Scores Display */}
{autoEvalResults[reply.id] && (
  <div className="mt-3 pt-3 border-t border-white/5">
    <div className="text-[10px] text-muted-foreground mb-2">AI Evaluation Scores:</div>
    <div className="grid grid-cols-3 gap-2 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Context:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].context_match)}>
          {autoEvalResults[reply.id].context_match}/10
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Effort:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].effort_asymmetry)}>
          {autoEvalResults[reply.id].effort_asymmetry}/10
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Human:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].bot_detection)}>
          {autoEvalResults[reply.id].bot_detection}/10
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Fresh:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].phrase_freshness)}>
          {autoEvalResults[reply.id].phrase_freshness}/10
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Status:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].status_preservation)}>
          {autoEvalResults[reply.id].status_preservation}/10
        </span>
      </div>
      <div className="flex justify-between font-medium">
        <span className="text-white">Overall:</span>
        <span className={getScoreColor(autoEvalResults[reply.id].overall)}>
          {autoEvalResults[reply.id].overall}/10
        </span>
      </div>
    </div>
  </div>
)}
```

---

### 2.2 Verify Backend Routes Exist

**Expected API Routes:**
1. `POST /api/finetune/auto-eval` - Single reply auto-evaluation
2. `POST /api/finetune/auto-eval-batch` - Batch auto-evaluation

**Check these locations in threadsponder:**
- `/packages/api/src/routes/` - Look for finetune routes
- `/packages/workers/src/` - Look for auto-eval worker implementations

**Reference implementation (eliza-threads):**
- `/Users/ariapramesi/repos/eliza-threads/agent/src/routes/finetune-routes.ts`

---

## Part 3: Technical Specifications

### 3.1 The 5-Dimension Scoring System (bloom-eval)

| Dimension | What It Measures | Score Range |
|-----------|------------------|-------------|
| `context_match` | Does reply address actual hostile content? | 1-10 |
| `effort_asymmetry` | Is reply appropriately short (1-15 words)? | 1-10 |
| `bot_detection` | Does it sound human? | 1-10 |
| `phrase_freshness` | Avoids overused phrases? | 1-10 |
| `status_preservation` | Maintains unbothered dominance? | 1-10 |
| `overall` | Weighted average of all dimensions | 1-10 |

### 3.2 Score-to-Rating Conversion

- Score >= 6: Rating = +1 (good reply)
- Score < 6: Rating = -1 (bad reply)

### 3.3 UI Color Coding

```typescript
const getScoreColor = (score: number): string => {
  if (score >= 8) return 'text-green-400';  // Excellent
  if (score >= 6) return 'text-yellow-400'; // Good
  if (score >= 4) return 'text-orange-400'; // Needs improvement
  return 'text-red-400';                     // Poor
};
```

---

## Part 4: File Locations Reference

### Source (eliza-threads)
```
/Users/ariapramesi/repos/eliza-threads/agent/client/
├── src/
│   ├── hooks/
│   │   └── useFineTune.ts (309 lines) - Complete with auto-eval
│   └── pages/
│       └── FineTune.tsx - Reference UI implementation
```

### Target (threadsponder)
```
/Users/ariapramesi/repos/threadsponder/packages/dashboard/
├── src/
│   ├── hooks/
│   │   └── useFineTune.ts (309 lines) - ✅ Updated with auto-eval hooks
│   └── pages/
│       └── FineTune.tsx (446 lines) - ⏳ Needs UI updates
```

---

## Part 5: Checklist for Next Agent

### Immediate Tasks
- [ ] Read `/Users/ariapramesi/repos/threadsponder/packages/dashboard/src/pages/FineTune.tsx`
- [ ] Add imports (useAutoEval, useAutoEvalBatch, AutoEvalScores, Zap, Brain)
- [ ] Add state variables (autoEvalResults, autoEvalInProgress, batchEvalInProgress)
- [ ] Add hooks (autoEval, autoEvalBatch)
- [ ] Add handler functions (handleAutoEval, handleBatchAutoEval, getScoreColor)
- [ ] Add Brain button in header for batch auto-eval
- [ ] Add Zap button after ThumbsDown for single auto-eval
- [ ] Add score display grid showing 5 dimensions

### Verification Tasks
- [ ] Check if `/api/finetune/auto-eval` route exists in threadsponder API
- [ ] Check if `/api/finetune/auto-eval-batch` route exists in threadsponder API
- [ ] If routes don't exist, port them from eliza-threads

### Testing
- [ ] Build the dashboard: `cd packages/dashboard && npm run build`
- [ ] Check for TypeScript errors
- [ ] Test UI in browser (if dev server available)

---

## Part 6: Code Diff Summary

### useFineTune.ts Changes (ALREADY DONE)
- Added 91 lines of code
- Types: AutoEvalScores, AutoEvalResult, AutoEvalBatchResult
- Hooks: useAutoEval(), useAutoEvalBatch()

### FineTune.tsx Changes (NEEDED)
Estimated additions: ~80 lines
- Import changes: +4 items
- State additions: +3 variables
- Hook additions: +2 hooks
- Handler functions: +3 functions (~35 lines)
- UI elements: Brain button (~15 lines), Zap button (~15 lines), Score grid (~25 lines)

---

## Part 7: Known Differences Between Projects

| Aspect | eliza-threads | threadsponder |
|--------|---------------|---------------|
| Unrated refresh | 10 seconds | 60 seconds |
| Package structure | Single agent | Monorepo (packages/) |
| API location | /src/routes/ | /packages/api/src/routes/ |
| Dashboard location | /client/src/ | /packages/dashboard/src/ |

---

## Questions for Next Agent

1. Do the backend routes for auto-eval exist in threadsponder?
2. If not, should we port them from eliza-threads?
3. Is there a different API structure in threadsponder that needs consideration?

---

**Handover prepared by**: Claude (Opus 4.5)
**Date**: January 1, 2026
**Context window reason**: Previous session reached context limit, needed clean handover
