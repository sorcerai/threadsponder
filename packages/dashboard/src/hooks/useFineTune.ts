import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types
export interface ReplyFeedback {
  replyId: string;
  rating: 1 | -1;
  ratedAt: number;
  pattern?: string;
  classification?: string;
}

export interface PatternScore {
  pattern: string;
  positive: number;
  negative: number;
  total: number;
  score: number;
  trend: 'improving' | 'declining' | 'stable';
}

export interface BannedPhrase {
  phrase: string;
  addedAt: number;
  reason?: string;
}

export interface FineTuneStats {
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  overallScore: number;
  bestPattern: { name: string; score: number } | null;
  worstPattern: { name: string; score: number } | null;
  patternsTracked: number;
  bannedPhrases: number;
}

export interface UnratedReply {
  id: string;
  hostile: {
    text: string;
    user: string;
  };
  our: {
    text: string;
  };
  classification: string;
  pattern: string;
  timestamp: number;
}

// Stats hook
export function useFineTuneStats() {
  return useQuery<{ success: boolean; stats: FineTuneStats }>({
    queryKey: ['finetune-stats'],
    queryFn: async () => {
      const res = await fetch('/api/finetune/stats');
      if (!res.ok) throw new Error('Failed to fetch fine-tune stats');
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 15000
  });
}

// Pattern scores hook
export function usePatternScores() {
  return useQuery<{ success: boolean; patterns: PatternScore[]; totalFeedback: number }>({
    queryKey: ['finetune-patterns'],
    queryFn: async () => {
      const res = await fetch('/api/finetune/patterns');
      if (!res.ok) throw new Error('Failed to fetch pattern scores');
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 15000
  });
}

// Unrated replies hook
export function useUnratedReplies(limit: number = 20) {
  return useQuery<{ success: boolean; replies: UnratedReply[]; count: number }>({
    queryKey: ['finetune-unrated', limit],
    queryFn: async () => {
      const res = await fetch(`/api/finetune/replies-for-rating?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch unrated replies');
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000
  });
}

// Feedback history hook
export function useFeedbackHistory(limit: number = 50) {
  return useQuery<{ success: boolean; history: ReplyFeedback[]; count: number }>({
    queryKey: ['finetune-history', limit],
    queryFn: async () => {
      const res = await fetch(`/api/finetune/history?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch feedback history');
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 15000
  });
}

// Banned phrases hook
export function useBannedPhrases() {
  const queryClient = useQueryClient();

  const query = useQuery<{ success: boolean; phrases: BannedPhrase[]; count: number }>({
    queryKey: ['finetune-banned'],
    queryFn: async () => {
      const res = await fetch('/api/finetune/banned');
      if (!res.ok) throw new Error('Failed to fetch banned phrases');
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000
  });

  const addMutation = useMutation({
    mutationFn: async ({ phrase, reason }: { phrase: string; reason?: string }) => {
      const res = await fetch('/api/finetune/banned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, reason })
      });
      if (!res.ok) throw new Error('Failed to add banned phrase');
      return res.json();
    },
    onSuccess: () => {
      // Force immediate refetch (not just invalidate) to show new chip immediately
      queryClient.refetchQueries({ queryKey: ['finetune-banned'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-stats'] });
    }
  });

  const removeMutation = useMutation({
    mutationFn: async (phrase: string) => {
      const res = await fetch(`/api/finetune/banned/${encodeURIComponent(phrase)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to remove banned phrase');
      return res.json();
    },
    onSuccess: () => {
      // Force immediate refetch to update UI immediately
      queryClient.refetchQueries({ queryKey: ['finetune-banned'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-stats'] });
    }
  });

  return {
    ...query,
    phrases: query.data?.phrases || [],
    addPhrase: addMutation.mutate,
    removePhrase: removeMutation.mutate,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending
  };
}

// Submit feedback mutation
export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ replyId, rating }: { replyId: string; rating: 1 | -1 }) => {
      const res = await fetch('/api/finetune/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyId, rating })
      });
      if (!res.ok) throw new Error('Failed to submit feedback');
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

// Manual eval mutation - for manual input of hostile/reply pairs
export interface ManualEvalInput {
  hostileText: string;
  hostileUser?: string;
  ourReply: string;
  pattern?: string;
  classification?: string;
  rating: 1 | -1;
}

export function useManualEval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ManualEvalInput) => {
      const res = await fetch('/api/finetune/manual-eval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      if (!res.ok) throw new Error('Failed to submit manual eval');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finetune-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-patterns'] });
      queryClient.invalidateQueries({ queryKey: ['finetune-history'] });
    }
  });
}

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

// Auto-eval single reply mutation
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

// Auto-eval batch mutation - evaluate multiple unrated replies
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
