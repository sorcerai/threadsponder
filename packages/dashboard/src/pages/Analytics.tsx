import { SpotlightCard } from '@/components/ui/spotlight-card';
import { usePatterns, useClassifications, useHourlyDistribution } from '@/hooks/useAnalytics';
import { GhostAnalytics } from '@/components/analytics/GhostAnalytics';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend
} from 'recharts';
import { BarChart2, PieChartIcon, Zap } from 'lucide-react';

const COLORS = ['#ef4444', '#22c55e', '#6b7280'];

export default function Analytics() {
  const { data: patterns, isLoading: patternsLoading } = usePatterns();
  const { data: classifications, isLoading: classLoading } = useClassifications();
  const { data: hours, isLoading: hoursLoading } = useHourlyDistribution();

  // Transform data for charts
  const classificationData = classifications ? [
    { name: 'Hostile', value: classifications.hostile, color: '#ef4444' },
    { name: 'Friendly', value: classifications.friendly, color: '#22c55e' },
    { name: 'Neutral', value: classifications.neutral, color: '#6b7280' },
  ] : [];

  const hoursData = hours?.map((count, hour) => ({
    hour: `${hour}:00`,
    replies: count,
  })) || [];

  const patternEntries = patterns
    ? Object.entries(patterns).sort((a, b) => b[1].count - a[1].count)
    : [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Analytics</h1>
        <p className="text-muted-foreground text-sm max-w-lg">
          Performance metrics, pattern effectiveness, and engagement trends.
        </p>
      </div>

      {/* Ghost Analytics - Velocity & Engagement */}
      <GhostAnalytics />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Classification Breakdown */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Classification Breakdown</h3>
          </div>
          {classLoading ? (
            <div className="h-[200px] flex items-center justify-center text-zinc-500 text-sm">Loading...</div>
          ) : classificationData.length === 0 || classificationData.every(d => d.value === 0) ? (
            <div className="h-[200px] flex items-center justify-center text-zinc-500 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={classificationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {classificationData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  labelStyle={{ color: '#a1a1aa' }}
                  itemStyle={{ color: '#e4e4e7' }}
                />
                <Legend
                  formatter={(value) => <span className="text-zinc-400 text-xs">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SpotlightCard>

        {/* Hourly Distribution */}
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-zinc-500" />
            <h3 className="text-sm font-medium text-zinc-200">Hourly Distribution</h3>
          </div>
          {hoursLoading ? (
            <div className="h-[200px] flex items-center justify-center text-zinc-500 text-sm">Loading...</div>
          ) : hoursData.every(d => d.replies === 0) ? (
            <div className="h-[200px] flex items-center justify-center text-zinc-500 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hoursData}>
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={{ stroke: '#27272a' }}
                  tickLine={false}
                  interval={3}
                />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={{ stroke: '#27272a' }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  labelStyle={{ color: '#a1a1aa' }}
                />
                <Bar dataKey="replies" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SpotlightCard>
      </div>

      {/* Pattern Effectiveness */}
      <SpotlightCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">Pattern Effectiveness</h3>
        </div>
        {patternsLoading ? (
          <div className="text-zinc-500 text-sm">Loading...</div>
        ) : patternEntries.length === 0 ? (
          <div className="text-zinc-500 text-sm">No pattern data yet</div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {patternEntries.map(([name, stats]) => (
              <div key={name} className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <div className="flex-1">
                  <span className="text-sm font-medium text-zinc-200">{name.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-zinc-500 ml-2">{stats.count} uses</span>
                </div>
                {stats.examples[0] && (
                  <div className="text-xs text-zinc-500 max-w-[200px] truncate" title={stats.examples[0]}>
                    "{stats.examples[0]}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
