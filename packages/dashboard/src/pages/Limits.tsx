import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useGlobalRate,
  useCooloffs,
  useDepths,
  useUserLookup,
  useClearCooloff,
  useResetUserLimits
} from '@/hooks/useBotLoop';
import { Gauge, Clock, Users, Search, RefreshCw, X, AlertTriangle } from 'lucide-react';

export default function Limits() {
  const [lookupUsername, setLookupUsername] = useState('');
  const [searchTrigger, setSearchTrigger] = useState(false);

  const { data: globalRate, isLoading: rateLoading } = useGlobalRate();
  const { data: cooloffs, isLoading: cooloffsLoading, refetch: refetchCooloffs } = useCooloffs();
  const { data: depths, isLoading: depthsLoading } = useDepths();
  const { data: userStats, isLoading: userLoading } = useUserLookup(lookupUsername, searchTrigger);

  const clearCooloff = useClearCooloff();
  const resetLimits = useResetUserLimits();

  const handleSearch = () => {
    if (lookupUsername.trim()) {
      setSearchTrigger(true);
    }
  };

  const handleClearCooloff = async (username: string) => {
    await clearCooloff.mutateAsync(username);
  };

  const handleResetLimits = async (username: string) => {
    if (confirm(`Reset all limits for @${username}?`)) {
      await resetLimits.mutateAsync(username);
      setSearchTrigger(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const getRateColor = (status?: string) => {
    if (status === 'throttled') return 'bg-red-500';
    if (status === 'warning') return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Rate Limits</h1>
        <p className="text-muted-foreground text-sm max-w-lg">
          Monitor and manage rate limits, cooloffs, and conversation depths.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Global Rate */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Global Rate</h3>
          </div>
          {rateLoading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : globalRate ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="text-zinc-400">Current / Max</span>
                <span className="text-zinc-200 font-mono">
                  {globalRate.currentRate} / {globalRate.maxPerHour}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${getRateColor(globalRate.status)}`}
                  style={{ width: `${Math.min(parseFloat(globalRate.percentUsed), 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{globalRate.percentUsed}% used</span>
                <span className={
                  globalRate.status === 'throttled' ? 'text-red-400' :
                  globalRate.status === 'warning' ? 'text-yellow-400' : 'text-green-400'
                }>
                  {globalRate.status.toUpperCase()}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">No data</div>
          )}
        </SpotlightCard>

        {/* Active Cooloffs */}
        <SpotlightCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-medium text-zinc-200">Active Cooloffs</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetchCooloffs()} className="h-7 w-7 p-0">
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
          {cooloffsLoading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : !cooloffs || cooloffs.length === 0 ? (
            <div className="text-zinc-500 text-sm">No active cooloffs</div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {cooloffs.map((c) => (
                <div key={c.username} className="flex justify-between items-center p-2 bg-zinc-900/50 rounded border border-zinc-800">
                  <span className="text-sm text-zinc-200">@{c.username}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">{formatDuration(c.remainingSeconds)}</span>
                    <button
                      onClick={() => handleClearCooloff(c.username)}
                      className="text-red-400 hover:text-red-300"
                      disabled={clearCooloff.isPending}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>

        {/* Conversation Depths */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Conversation Depths</h3>
          </div>
          {depthsLoading ? (
            <div className="text-zinc-500 text-sm">Loading...</div>
          ) : !depths || depths.length === 0 ? (
            <div className="text-zinc-500 text-sm">No active conversations</div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {depths.slice(0, 15).map((d) => (
                <div key={d.username} className="flex justify-between items-center p-2 bg-zinc-900/50 rounded border border-zinc-800">
                  <span className="text-sm text-zinc-200">@{d.username}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Depth: {d.depth}</span>
                    <div className="w-12 bg-zinc-700 rounded h-1.5">
                      <div
                        className="bg-orange-500 h-1.5 rounded"
                        style={{ width: `${Math.min(d.depth * 20, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SpotlightCard>
      </div>

      {/* User Lookup */}
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">User Lookup</h3>
        </div>

        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Enter username..."
            value={lookupUsername}
            onChange={(e) => {
              setLookupUsername(e.target.value);
              setSearchTrigger(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="bg-zinc-900 border-zinc-800"
          />
          <Button onClick={handleSearch} variant="outline" className="bg-zinc-900 border-zinc-800">
            Search
          </Button>
        </div>

        {userLoading && (
          <div className="text-zinc-500 text-sm">Loading...</div>
        )}

        {searchTrigger && userStats && (
          <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800">
            <h4 className="font-bold text-zinc-200 mb-3">@{userStats.username}</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
              <div>
                <span className="text-zinc-500 block text-xs">In Cooloff</span>
                <span className={userStats.inCooloff ? 'text-red-400' : 'text-green-400'}>
                  {userStats.inCooloff ? 'Yes' : 'No'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500 block text-xs">Recent Replies</span>
                <span className="text-zinc-200">{userStats.recentReplies}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-xs">Total Interactions</span>
                <span className="text-zinc-200">{userStats.totalInteractions}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-xs">Active Depths</span>
                <span className="text-zinc-200">{userStats.conversationDepths.length}</span>
              </div>
            </div>

            {userStats.recentInteractions.length > 0 && (
              <div className="mt-4">
                <p className="text-zinc-500 text-xs mb-2">Recent Interactions:</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {userStats.recentInteractions.slice(0, 5).map((i, idx) => (
                    <div key={idx} className="bg-zinc-800/50 p-2 rounded text-xs">
                      <p className="text-zinc-300">{i.theirText.substring(0, 100)}</p>
                      <p className="text-blue-400 mt-1">→ {i.ourText}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              variant="destructive"
              size="sm"
              className="mt-4"
              onClick={() => handleResetLimits(userStats.username)}
              disabled={resetLimits.isPending}
            >
              <AlertTriangle className="w-3 h-3 mr-1" />
              Reset All Limits
            </Button>
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
