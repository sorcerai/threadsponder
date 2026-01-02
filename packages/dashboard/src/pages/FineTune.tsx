import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import {
  useFineTuneStats,
  usePatternScores,
  useUnratedReplies,
  useBannedPhrases,
  useSubmitFeedback,
  useManualEval,
  useAutoEval,
  useAutoEvalBatch,
  type AutoEvalScores
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
  RefreshCw,
  Zap,
  Brain
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FineTune() {
  const { data: statsData } = useFineTuneStats();
  const { data: patternsData, isLoading: patternsLoading } = usePatternScores();
  const { data: repliesData, isLoading: repliesLoading, refetch: refetchReplies, isFetching: repliesFetching } = useUnratedReplies(10);
  const { phrases, addPhrase, removePhrase, isAdding, isRemoving } = useBannedPhrases();
  const submitFeedback = useSubmitFeedback();

  const [newBannedPhrase, setNewBannedPhrase] = useState('');
  const [ratingInProgress, setRatingInProgress] = useState<string | null>(null);

  // Auto-eval state
  const [autoEvalResults, setAutoEvalResults] = useState<Record<string, AutoEvalScores>>({});
  const [autoEvalInProgress, setAutoEvalInProgress] = useState<string | null>(null);
  const [batchEvalInProgress, setBatchEvalInProgress] = useState(false);

  // Auto-eval hooks
  const autoEval = useAutoEval();
  const autoEvalBatch = useAutoEvalBatch();

  // Manual eval state
  const manualEval = useManualEval();
  const [manualHostile, setManualHostile] = useState('');
  const [manualReply, setManualReply] = useState('');
  const [selectedForManual, setSelectedForManual] = useState<string | null>(null);

  const stats = statsData?.stats;
  const patterns = patternsData?.patterns || [];
  const unratedReplies = repliesData?.replies || [];

  const handleRating = async (replyId: string, rating: 1 | -1) => {
    setRatingInProgress(replyId);
    try {
      await submitFeedback.mutateAsync({ replyId, rating });
    } finally {
      setRatingInProgress(null);
    }
  };

  const handleAddBannedPhrase = () => {
    if (!newBannedPhrase.trim()) return;
    addPhrase({ phrase: newBannedPhrase.trim() });
    setNewBannedPhrase('');
  };

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

  // Select hostile for manual reply - pre-populate with AI's reply for tweaking
  const handleSelectForManual = (reply: typeof unratedReplies[0]) => {
    setSelectedForManual(reply.id);
    setManualHostile(reply.hostile.text);
    setManualReply(reply.our.text); // Pre-populate with AI's reply for editing
  };

  // Submit manual eval - always positive since it's manual fine-tuning
  const handleManualEval = async () => {
    if (!manualHostile.trim() || !manualReply.trim()) return;

    await manualEval.mutateAsync({
      hostileText: manualHostile,
      ourReply: manualReply,
      rating: 1 // Manual submissions are always "good" training data
    });

    // Clear form after submit
    setManualHostile('');
    setManualReply('');
    setSelectedForManual(null);
  };

  const getTrendIcon = (trend: 'improving' | 'declining' | 'stable') => {
    switch (trend) {
      case 'improving':
        return <TrendingUp className="w-4 h-4 text-green-500" />;
      case 'declining':
        return <TrendingDown className="w-4 h-4 text-red-500" />;
      default:
        return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Fine Tune</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rate replies to improve AI Agent behavior over time
          </p>
        </div>
        {/* Batch Auto-Eval Button */}
        {unratedReplies.length > 0 && (
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
            {batchEvalInProgress ? 'Evaluating...' : `Auto-Eval All (${unratedReplies.length})`}
          </button>
        )}
      </div>

      {/* Manual Eval Section - Write your own reply */}
      <SpotlightCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Manual Evaluation</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Write/tweak a reply to a comment
            </p>
          </div>
          {selectedForManual && (
            <button
              onClick={() => {
                setSelectedForManual(null);
                setManualHostile('');
                setManualReply('');
              }}
              className="text-xs text-muted-foreground hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* Hostile comment input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Comment {selectedForManual && <span className="text-orange-400">(from list)</span>}
            </label>
            <textarea
              value={manualHostile}
              onChange={(e) => setManualHostile(e.target.value)}
              placeholder="Paste or type the comment here..."
              rows={2}
              className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/50 resize-none"
            />
          </div>

          {/* Your reply input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Your reply</label>
            <textarea
              value={manualReply}
              onChange={(e) => setManualReply(e.target.value)}
              placeholder="Write your reply here..."
              rows={3}
              className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/50 resize-none"
            />
          </div>

          {/* Submit button */}
          <button
            onClick={handleManualEval}
            disabled={!manualHostile.trim() || !manualReply.trim() || manualEval.isPending}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
              "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {manualEval.isPending ? 'Submitting...' : 'Submit Fine Tune'}
          </button>

          {manualEval.isSuccess && (
            <p className="text-xs text-green-400 text-center">Fine tune submitted!</p>
          )}
        </div>
      </SpotlightCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rate Replies Section - now with "use for manual" button */}
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Hostile Comments</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {unratedReplies.length} available
              </span>
              <button
                onClick={() => refetchReplies()}
                disabled={repliesFetching}
                className={cn(
                  "p-1.5 rounded-md transition-all",
                  "bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                title="Refresh comments"
              >
                <RefreshCw className={cn("w-4 h-4", repliesFetching && "animate-spin")} />
              </button>
            </div>
          </div>

          {repliesLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : unratedReplies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ThumbsUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No comments available</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
              {unratedReplies.map((reply) => (
                <div
                  key={reply.id}
                  className={cn(
                    "p-4 rounded-lg border bg-black/20 space-y-3 cursor-pointer transition-all",
                    selectedForManual === reply.id
                      ? "border-orange-500/50 bg-orange-500/5"
                      : "border-white/5 hover:border-white/10"
                  )}
                  onClick={() => handleSelectForManual(reply)}
                >
                  {/* Hostile comment */}
                  <div>
                    <p className="text-xs text-red-400 mb-1">
                      @{reply.hostile.user} ({reply.classification})
                    </p>
                    <p className="text-sm text-muted-foreground">
                      "{reply.hostile.text}"
                    </p>
                  </div>

                  {/* AI Agent's reply (for reference) */}
                  <div className="pl-4 border-l-2 border-zinc-700">
                    <p className="text-xs text-zinc-500 mb-1">AI Agent replied:</p>
                    <p className="text-xs text-zinc-400">"{reply.our.text}"</p>
                  </div>

                  {/* Pattern tag + select hint */}
                  <div className="flex items-center justify-between">
                    {reply.pattern && (
                      <span className="inline-block px-2 py-0.5 text-xs rounded bg-white/5 text-muted-foreground">
                        {reply.pattern}
                      </span>
                    )}
                    <span className="text-[10px] text-orange-400/50">
                      {selectedForManual === reply.id ? 'Selected' : 'Click to reply'}
                    </span>
                  </div>

                  {/* Quick rate buttons (for existing AI Agent reply) */}
                  <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                    <span className="text-[10px] text-muted-foreground mr-2">Rate AI Agent's reply:</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRating(reply.id, 1);
                      }}
                      disabled={ratingInProgress === reply.id || submitFeedback.isPending}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs transition-all",
                        "bg-green-500/10 text-green-400 hover:bg-green-500/20",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <ThumbsUp className="w-3 h-3" />
                    </button>
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
                  </div>

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
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>

        {/* Pattern Scores Section */}
        <SpotlightCard className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Pattern Scores</h2>

          {patternsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : patterns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No pattern data yet. Rate some replies!</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {patterns.map((pattern) => (
                <div
                  key={pattern.pattern}
                  className="p-3 rounded-lg border border-white/5 bg-black/20"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">
                      {pattern.pattern}
                    </span>
                    <div className="flex items-center gap-2">
                      {getTrendIcon(pattern.trend)}
                      <span className={cn(
                        "text-sm font-bold",
                        pattern.score >= 0.7 ? "text-green-400" :
                          pattern.score >= 0.4 ? "text-yellow-400" : "text-red-400"
                      )}>
                        {Math.round(pattern.score * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all",
                        pattern.score >= 0.7 ? "bg-green-500" :
                          pattern.score >= 0.4 ? "bg-yellow-500" : "bg-red-500"
                      )}
                      style={{ width: `${pattern.score * 100}%` }}
                    />
                  </div>

                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="text-green-400">+{pattern.positive}</span>
                    <span className="text-red-400">-{pattern.negative}</span>
                    <span>({pattern.total} total)</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Best/Worst patterns */}
          {stats?.bestPattern && stats?.worstPattern && (
            <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Best Pattern</p>
                <p className="text-sm font-medium text-green-400">
                  {stats.bestPattern.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(stats.bestPattern.score * 100)}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">Needs Work</p>
                <p className="text-sm font-medium text-red-400">
                  {stats.worstPattern.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(stats.worstPattern.score * 100)}%
                </p>
              </div>
            </div>
          )}
        </SpotlightCard>
      </div>

      {/* Banned Phrases Section */}
      <SpotlightCard className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Banned Phrases</h2>
            <p className="text-xs text-muted-foreground mt-1">
              AI Agent will avoid using these phrases in replies
            </p>
          </div>
        </div>

        {/* Add new phrase */}
        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={newBannedPhrase}
            onChange={(e) => setNewBannedPhrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddBannedPhrase()}
            placeholder="Add banned phrase..."
            className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-orange-500/50"
          />
          <button
            onClick={handleAddBannedPhrase}
            disabled={!newBannedPhrase.trim() || isAdding}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all",
              "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Phrases list */}
        {phrases.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Ban className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No banned phrases yet</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {phrases.map((item) => (
              <div
                key={item.phrase}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-full"
              >
                <span className="text-sm text-red-400">{item.phrase}</span>
                <button
                  onClick={() => removePhrase(item.phrase)}
                  disabled={isRemoving}
                  className="text-red-400/50 hover:text-red-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>

      {/* Info Box */}
      <SpotlightCard className="p-4 border-orange-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-white">How Fine-Tuning Works</p>
            <p className="text-xs text-muted-foreground mt-1">
              Rate replies as good or bad to train pattern preferences. Patterns with higher
              scores will be favored in future reply generation. Add banned phrases to
              completely prevent certain responses.
            </p>
          </div>
        </div>
      </SpotlightCard>
    </div>
  );
}
