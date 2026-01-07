/**
 * Ghost Analytics Component
 *
 * Displays velocity and engagement metrics that Meta doesn't show natively:
 * - Velocity: How fast posts gain views compared to your average
 * - Engagement Rate: (likes + replies + quotes) / views
 */

import { useGhostAnalytics } from '@/hooks/useAnalytics';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Flame, TrendingUp, Eye, Sparkles, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

  if (diffHours < 1) return 'just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

function VelocityBadge({ velocity }: { velocity: string | null }) {
  if (!velocity) return null;
  const v = parseFloat(velocity);

  if (v >= 3) {
    return (
      <Badge className="bg-gradient-to-r from-orange-500 to-red-500 text-white border-0 gap-1">
        <Flame className="w-3 h-3" />
        {v}x viral
      </Badge>
    );
  }
  if (v >= 2) {
    return (
      <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 gap-1">
        <Zap className="w-3 h-3" />
        {v}x hot
      </Badge>
    );
  }
  if (v >= 1.5) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
        <TrendingUp className="w-3 h-3" />
        {v}x above avg
      </Badge>
    );
  }
  return (
    <Badge className="bg-zinc-700/50 text-zinc-400 border-zinc-600/30">
      {v}x
    </Badge>
  );
}

function BaselineStats() {
  const { data, isLoading } = useGhostAnalytics();

  if (isLoading) {
    return (
      <SpotlightCard className="p-6">
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      </SpotlightCard>
    );
  }

  if (!data?.baseline) return null;

  const { baseline } = data;

  return (
    <SpotlightCard className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-orange-500" />
        <h3 className="text-lg font-semibold text-white">Your Baseline</h3>
        {!baseline.hasEnoughData && (
          <Badge variant="outline" className="text-xs text-zinc-500">
            Need 5+ posts for accurate baseline
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-800/50 rounded-lg p-4">
          <div className="text-sm text-zinc-400 mb-1">Avg Engagement</div>
          <div className="text-2xl font-bold text-white">
            {baseline.avgEngagementRate}%
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            (likes+replies+quotes)/views
          </div>
        </div>

        <div className="bg-zinc-800/50 rounded-lg p-4">
          <div className="text-sm text-zinc-400 mb-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Velocity @1h
          </div>
          <div className="text-2xl font-bold text-white">
            {baseline.avgVelocity1h}
          </div>
          <div className="text-xs text-zinc-500 mt-1">views/hour</div>
        </div>

        <div className="bg-zinc-800/50 rounded-lg p-4">
          <div className="text-sm text-zinc-400 mb-1">Velocity @6h</div>
          <div className="text-2xl font-bold text-white">
            {baseline.avgVelocity6h}
          </div>
          <div className="text-xs text-zinc-500 mt-1">views/hour</div>
        </div>

        <div className="bg-zinc-800/50 rounded-lg p-4">
          <div className="text-sm text-zinc-400 mb-1">Sample Size</div>
          <div className="text-2xl font-bold text-white">
            {baseline.sampleCount}
          </div>
          <div className="text-xs text-zinc-500 mt-1">posts analyzed</div>
        </div>
      </div>
    </SpotlightCard>
  );
}

function TopPerformers() {
  const { data, isLoading } = useGhostAnalytics();

  if (isLoading) {
    return (
      <SpotlightCard className="p-6">
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      </SpotlightCard>
    );
  }

  if (!data?.topPosts?.length) {
    return (
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-semibold text-white">Top Performers</h3>
        </div>
        <div className="text-center py-8 text-zinc-500">
          <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No velocity data yet</p>
          <p className="text-sm">Posts need time to accumulate metrics</p>
        </div>
      </SpotlightCard>
    );
  }

  return (
    <SpotlightCard className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-orange-500" />
        <h3 className="text-lg font-semibold text-white">Top Performers</h3>
        <span className="text-xs text-zinc-500">by velocity</span>
      </div>

      <div className="space-y-3">
        {data.topPosts.slice(0, 5).map((post, idx) => (
          <div
            key={post.postId}
            className={cn(
              'flex items-start gap-3 p-3 rounded-lg transition-colors',
              post.isHot ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-zinc-800/50'
            )}
          >
            <span className="text-lg font-bold text-zinc-500 w-6">
              #{idx + 1}
            </span>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{post.text}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" /> {post.views?.toLocaleString() ?? 0}
                </span>
                <span>{post.engagementRate}% eng</span>
                <span>{formatTimeAgo(post.postedAt)}</span>
              </div>
            </div>

            <VelocityBadge velocity={post.velocityVsAvg} />
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}

function VelocityTrend() {
  const { data, isLoading } = useGhostAnalytics();

  if (isLoading) {
    return (
      <SpotlightCard className="p-6">
        <Skeleton className="h-6 w-40 mb-4" />
        <Skeleton className="h-48" />
      </SpotlightCard>
    );
  }

  if (!data?.hourlyTrend?.length) {
    return null;
  }

  const chartData = data.hourlyTrend.map((t) => ({
    hour: new Date(t.hour).toLocaleTimeString([], { hour: '2-digit' }),
    views: t.totalViews,
    velocity: parseFloat(t.avgVelocity),
  }));

  return (
    <SpotlightCard className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-5 h-5 text-orange-500" />
        <h3 className="text-lg font-semibold text-white">24h Velocity Trend</h3>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis
              dataKey="hour"
              stroke="#71717a"
              fontSize={12}
              tickLine={false}
            />
            <YAxis stroke="#71717a" fontSize={12} tickLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '8px',
              }}
              labelStyle={{ color: '#fff' }}
            />
            <Line
              type="monotone"
              dataKey="views"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              name="Views"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SpotlightCard>
  );
}

function EvergreenCandidates() {
  const { data, isLoading } = useGhostAnalytics();

  if (isLoading || !data?.evergreenCandidates?.length) return null;

  return (
    <SpotlightCard className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-green-500" />
        <h3 className="text-lg font-semibold text-white">Evergreen Candidates</h3>
        <span className="text-xs text-zinc-500">high engagement, 90+ days old</span>
      </div>

      <div className="space-y-2">
        {data.evergreenCandidates.map((post) => (
          <div
            key={post.postId}
            className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{post.text}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
                <span>{post.views?.toLocaleString() ?? 0} views</span>
                <span>{post.engagementRate}% engagement</span>
              </div>
            </div>
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              Recycle
            </Badge>
          </div>
        ))}
      </div>
    </SpotlightCard>
  );
}

export function GhostAnalytics() {
  const { data, isLoading, error } = useGhostAnalytics();

  if (error) {
    return (
      <SpotlightCard className="p-6">
        <div className="text-center py-8 text-red-400">
          <p>Failed to load Ghost Analytics</p>
          <p className="text-sm text-zinc-500 mt-1">{error.message}</p>
        </div>
      </SpotlightCard>
    );
  }

  if (!isLoading && !data?.hasData) {
    return (
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-semibold text-white">Ghost Analytics</h3>
          <Badge variant="outline" className="text-xs">Beta</Badge>
        </div>
        <div className="text-center py-12 text-zinc-500">
          <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg">No metrics data yet</p>
          <p className="text-sm mt-2">
            Metrics are collected every 5 minutes for your recent posts.
            <br />
            Check back in a few hours to see velocity and engagement data.
          </p>
        </div>
      </SpotlightCard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-white">Ghost Analytics</h2>
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          Beta
        </Badge>
        <span className="text-sm text-zinc-500">
          Metrics Meta doesn't show
        </span>
      </div>

      <BaselineStats />

      <div className="grid lg:grid-cols-2 gap-6">
        <TopPerformers />
        <VelocityTrend />
      </div>

      <EvergreenCandidates />
    </div>
  );
}

export default GhostAnalytics;
