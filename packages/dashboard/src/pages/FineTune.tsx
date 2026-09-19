import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import {
  useFineTuneStats,
  usePatternScores,
  useUnratedReplies,
  useFreshHostile,
  useBannedPhrases,
  useSubmitFeedback,
  useManualEval,
  useAutoEval,
  useAutoEvalBatch,
  useClearPatterns,
  useRemovePattern,
  AutoEvalScores
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
  Brain,
  MessageCircle,
  Clock,
  Trash2
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FineTune() {
  const { data: statsData } = useFineTuneStats();
  const { data: patternsData, isLoading: patternsLoading } = usePatternScores();
  const { data: repliesData, isLoading: repliesLoading, refetch: refetchReplies, isFetching: repliesFetching } = useUnratedReplies(10);
  const { data: freshData, isLoading: freshLoading, refetch: refetchFresh, isFetching: freshFetching } = useFreshHostile(20);
  const { phrases, addPhrase, removePhrase, isAdding, isRemoving } = useBannedPhrases();
  const submitFeedback = useSubmitFeedback();
  const autoEval = useAutoEval();
  const autoEvalBatch = useAutoEvalBatch();
  const clearPatterns = useClearPatterns();
  const removePattern = useRemovePattern();

  const [activeTab, setActiveTab] = useState<'fresh' | 'responses'>('fresh');
  const [newBannedPhrase, setNewBannedPhrase] = useState('');
  const [ratingInProgress, setRatingInProgress] = useState<string | null>(null);
  const [autoEvalResults, setAutoEvalResults] = useState<Record<string, AutoEvalScores>>({});
  const [autoEvalErrors, setAutoEvalErrors] = useState<Record<string, string>>({});
  const [autoEvalInProgress, setAutoEvalInProgress] = useState<string | null>(null);

  // Manual eval state
  const manualEval = useManualEval();
  const [manualHostile, setManualHostile] = useState('');
  const [manualReply, setManualReply] = useState('');
  const [selectedForManual, setSelectedForManual] = useState<string | null>(null);

  const stats = statsData?.stats;
  const patterns = patternsData?.patterns || [];
  const unratedReplies = repliesData?.replies || [];
  const freshComments = freshData?.comments || [];

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

  // Select comment for manual reply - pre-populate with AI's reply for tweaking
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

  // Auto-eval single reply
  const handleAutoEval = async (replyId: string) => {
    setAutoEvalInProgress(replyId);
    setAutoEvalErrors(prev => {
      const next = { ...prev };
      delete next[replyId];
      return next;
    });
    
    try {
      // Don't save feedback automatically - let user see scores first
      const result = await autoEval.mutateAsync({ replyId, saveFeedback: false });
      if (result.success) {
        setAutoEvalResults(prev => ({ ...prev, [replyId]: result.scores }));
      }
    } catch (error) {
      console.error('Auto-eval failed:', error);
      setAutoEvalErrors(prev => ({ ...prev, [replyId]: error instanceof Error && error.message ? error.message : 'Evaluation failed' }));
    } finally {
      setAutoEvalInProgress(null);
    }
  };

  // Batch auto-eval all unrated replies
  const handleBatchAutoEval = async () => {
    // Clear previous errors
    setAutoEvalErrors({});
    
    try {
      const result = await autoEvalBatch.mutateAsync({ limit: 10 });
      if (result.success) {
        const newScores: Record<string, AutoEvalScores> = {};
        const newErrors: Record<string, string> = {};
        
        for (const r of result.results) {
          if (r.scores) {
            newScores[r.replyId] = r.scores;
          } else if (r.error) {
            newErrors[r.replyId] = r.error;
          }
        }
        setAutoEvalResults(prev => ({ ...prev, ...newScores }));
        setAutoEvalErrors(prev => ({ ...prev, ...newErrors }));
      }
    } catch (error) {
      console.error('Batch auto-eval failed:', error);
    }
  };

  // Score color based on value (1-10 scale)
  const getScoreColor = (score: number) => {
    if (score >= 7) return 'text-green-400';
    if (score >= 5) return 'text-yellow-400';
    return 'text-red-400';
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
        <button
          onClick={handleBatchAutoEval}
          disabled={autoEvalBatch.isPending || unratedReplies.length === 0}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
            "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          title="Auto-evaluate all unrated replies using AI"
        >
          <Brain className={cn("w-4 h-4", autoEvalBatch.isPending && "animate-pulse")} />
          {autoEvalBatch.isPending ? 'Evaluating...' : 'Auto-Eval All'}
        </button>
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
          {/* Original comment input */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Original Comment {selectedForManual && <span className="text-orange-400">(from list)</span>}
            </label>
            <textarea
              value={manualHostile}
              onChange={(e) => setManualHostile(e.target.value)}
              placeholder="Paste or type the original comment here..."
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
        {/* Comments Section - with Fresh/Responses tabs */}
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Comments</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {activeTab === 'fresh' ? freshComments.length : unratedReplies.length} available
              </span>
              <button
                onClick={() => activeTab === 'fresh' ? refetchFresh() : refetchReplies()}
                disabled={activeTab === 'fresh' ? freshFetching : repliesFetching}
                className={cn(
                  "p-1.5 rounded-md transition-all",
                  "bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                title="Refresh comments"
              >
                <RefreshCw className={cn("w-4 h-4", (freshFetching || repliesFetching) && "animate-spin")} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('fresh')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                activeTab === 'fresh'
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              Fresh ({freshComments.length})
            </button>
            <button
              onClick={() => setActiveTab('responses')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                activeTab === 'responses'
                  ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                  : "bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10"
              )}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Responses ({unratedReplies.length})
            </button>
          </div>

          {/* Fresh Tab Content */}
          {activeTab === 'fresh' && (
            freshLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : freshComments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No fresh comments yet</p>
                <p className="text-xs mt-1">Comments will appear here as they come in</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {freshComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="p-4 rounded-lg border border-green-500/20 bg-green-500/5 space-y-2 cursor-pointer hover:border-green-500/40 transition-all"
                    onClick={() => {
                      setManualHostile(comment.text);
                      setManualReply('');
                      setSelectedForManual(comment.id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-green-400">@{comment.username}</p>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(comment.capturedAt || comment.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-white">"{comment.text}"</p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        Post: {comment.postId.slice(-8)}
                      </span>
                      <span className="text-[10px] text-green-400/50">Click to reply</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Responses Tab Content */}
          {activeTab === 'responses' && (
            repliesLoading ? (
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
                  {/* Original comment */}
                  <div>
                    <p className="text-xs text-orange-400 mb-1">
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

                    {/* Auto-eval button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAutoEval(reply.id);
                      }}
                      disabled={autoEvalInProgress === reply.id || autoEval.isPending}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ml-2",
                        "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20",
                        "disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                      title="Auto-evaluate this reply with AI"
                    >
                      <Zap className={cn("w-3 h-3", autoEvalInProgress === reply.id && "animate-pulse")} />
                      {autoEvalInProgress === reply.id ? '...' : 'AI'}
                    </button>
                  </div>

                  {/* Auto-eval Loading State */}
                  {(autoEvalInProgress === reply.id || autoEvalBatch.isPending) && (
                    <div className="pt-3 border-t border-purple-500/20 mt-2 animate-pulse">
                      <div className="flex items-center gap-2 text-purple-400">
                        <Brain className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-medium">AI Analyzing Reply...</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                        Checking Context, Effort, Humanity, Freshness, and Status.
                      </p>
                    </div>
                  )}

                  {/* Auto-eval Error Display */}
                  {autoEvalErrors[reply.id] && (
                    <div className="pt-3 border-t border-red-500/20 mt-2">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-xs font-medium">Analysis Failed</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                        {autoEvalErrors[reply.id]}
                      </p>
                    </div>
                  )}

                  {/* Auto-eval score display */}
                  {autoEvalResults[reply.id] && (
                    <div className="pt-2 border-t border-purple-500/20 mt-2">
                      <div className="flex items-center gap-1 mb-2">
                        <Brain className="w-3 h-3 text-purple-400" />
                        <span className="text-[10px] text-purple-400 font-medium">Auto-Eval Scores</span>
                        <span className={cn("ml-auto text-sm font-bold", getScoreColor(autoEvalResults[reply.id].overall))}>
                          {autoEvalResults[reply.id].overall.toFixed(1)}/10
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-[9px]">
                        <div className="text-center">
                          <div className="text-muted-foreground">Context</div>
                          <div className={getScoreColor(autoEvalResults[reply.id].context_match)}>
                            {autoEvalResults[reply.id].context_match.toFixed(1)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-muted-foreground">Effort</div>
                          <div className={getScoreColor(autoEvalResults[reply.id].effort_asymmetry)}>
                            {autoEvalResults[reply.id].effort_asymmetry.toFixed(1)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-muted-foreground">Human</div>
                          <div className={getScoreColor(autoEvalResults[reply.id].bot_detection)}>
                            {autoEvalResults[reply.id].bot_detection.toFixed(1)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-muted-foreground">Fresh</div>
                          <div className={getScoreColor(autoEvalResults[reply.id].phrase_freshness)}>
                            {autoEvalResults[reply.id].phrase_freshness.toFixed(1)}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-muted-foreground">Status</div>
                          <div className={getScoreColor(autoEvalResults[reply.id].status_preservation)}>
                            {autoEvalResults[reply.id].status_preservation.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            )
          )}
        </SpotlightCard>

        {/* Pattern Scores Section */}
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Pattern Scores</h2>
            {patterns.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Clear all pattern scores? This cannot be undone.')) {
                    clearPatterns.mutate();
                  }
                }}
                disabled={clearPatterns.isPending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {clearPatterns.isPending ? 'Clearing...' : 'Clear All'}
              </button>
            )}
          </div>

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
                      <button
                        onClick={() => removePattern.mutate(pattern.pattern)}
                        disabled={removePattern.isPending}
                        className="p-0.5 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Remove pattern"
                      >
                        <X className="w-3 h-3" />
                      </button>
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
