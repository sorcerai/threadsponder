import { useState } from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { AchievementsCard } from '@/components/ui/achievements-card';
import { useEODReport, useExportReport } from '@/hooks/useEODReport';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  FileText, ChevronLeft, ChevronRight, RefreshCw, Download,
  TrendingUp, TrendingDown, Minus, Clock, Target, Zap, Info, MessageSquare
} from 'lucide-react';

// Simple tooltip component with isolated hover
function InfoTooltip({ text, align = 'center' }: { text: string; align?: 'left' | 'center' | 'right' }) {
  const alignClass = align === 'left'
    ? 'left-0'
    : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';
  const arrowClass = align === 'left'
    ? 'left-2'
    : align === 'right'
      ? 'right-2'
      : 'left-1/2 -translate-x-1/2';

  return (
    <div className="group/tooltip relative inline-block ml-1 isolate">
      <Info className="w-3 h-3 text-zinc-600 hover:text-zinc-400 cursor-help" />
      <div className={`absolute bottom-full ${alignClass} mb-2 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-300 whitespace-nowrap invisible group-hover/tooltip:visible opacity-0 group-hover/tooltip:opacity-100 transition-all pointer-events-none z-50 shadow-lg`}>
        {text}
        <div className={`absolute top-full ${arrowClass} border-4 border-transparent border-t-zinc-800`} />
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

function TrendIcon({ value }: { value: number }) {
  if (value > 0) return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  if (value < 0) return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-zinc-500" />;
}

function TrendValue({ value, suffix = '', invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  const isPositive = invert ? value < 0 : value > 0;
  const color = value === 0 ? 'text-zinc-500' : isPositive ? 'text-emerald-400' : 'text-red-400';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`font-mono ${color}`}>{sign}{value}{suffix}</span>
  );
}

export default function EODReport() {
  const today = getDateString(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [comparePeriod, setComparePeriod] = useState<'yesterday' | 'lastweek'>('yesterday');

  const { report, isLoading, generate, isGenerating } = useEODReport(selectedDate, comparePeriod);
  const exportReport = useExportReport();

  const navigateDate = (days: number) => {
    const date = new Date(selectedDate + 'T00:00:00');
    date.setDate(date.getDate() + days);
    if (date <= new Date()) {
      setSelectedDate(getDateString(date));
    }
  };

  const isToday = selectedDate === today;

  // Classification percentages
  const total = report?.summary?.totalReplies || 0;
  const getPercent = (val: number) => total > 0 ? Math.round((val / total) * 100) : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">
            EOD Report
          </h1>
          <p className="text-muted-foreground text-sm max-w-lg">
            Daily engagement summary with comparisons and trends.
          </p>
        </div>

        <div className="flex gap-2">
          <AchievementsCard />
          <Button
            variant="outline"
            size="sm"
            onClick={() => generate(selectedDate)}
            disabled={isGenerating}
            className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-xs gap-2"
          >
            <RefreshCw className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? 'Generating...' : 'Regenerate'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportReport.mutate({ date: selectedDate, format: 'csv' })}
            className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-xs gap-2"
          >
            <Download className="w-3 h-3" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800 rounded-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigateDate(-1)}
          className="text-zinc-400 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Prev
        </Button>

        <div className="flex items-center gap-4">
          <FileText className="w-4 h-4 text-orange-500" />
          <span className="text-white font-medium">
            {formatDate(selectedDate)}
            {isToday && <span className="ml-2 text-xs text-orange-400">(Today)</span>}
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigateDate(1)}
          disabled={isToday}
          className="text-zinc-400 hover:text-white disabled:opacity-30"
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64 text-zinc-500">Loading report...</div>
      ) : !report ? (
        <div className="flex flex-col items-center justify-center h-64 text-zinc-500">
          <p>No report available for this date</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => generate(selectedDate)}
            className="mt-4"
          >
            Generate Report
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Left Column - Summary & Patterns */}
          <div className="flex flex-col gap-6">
            {/* Daily Summary */}
            <SpotlightCard className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="w-4 h-4 text-orange-500" />
                <h3 className="text-sm font-medium text-zinc-200">Daily Summary</h3>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center p-2 bg-zinc-900/50 rounded">
                  <span className="text-xs text-zinc-400 flex items-center">
                    Total Replies
                    <InfoTooltip text="Number of comments we responded to today" />
                  </span>
                  <span className="text-lg font-semibold text-white">{report.summary.totalReplies}</span>
                </div>

                <div className="flex justify-between items-center p-2 bg-orange-500/10 rounded border border-orange-500/20">
                  <span className="text-xs text-orange-400 flex items-center">
                    🎯 Baits Raged
                    <InfoTooltip text="Hostile replies to OUR replies = we triggered them" />
                  </span>
                  <span className="text-lg font-semibold text-orange-400">{report.summary.triggered || 0}</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-red-500/10 rounded border border-red-500/20">
                    <span className="text-[10px] text-red-400 uppercase flex items-center gap-1">
                      Hostile
                      <InfoTooltip text="Attacks, insults, trolling" align="left" />
                    </span>
                    <div className="text-sm font-medium text-white">
                      {report.summary.classifications.hostile}
                      <span className="text-[10px] text-zinc-500 ml-1">
                        ({getPercent(report.summary.classifications.hostile)}%)
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20">
                    <span className="text-[10px] text-emerald-400 uppercase flex items-center gap-1">
                      Friendly
                      <InfoTooltip text="Supportive, positive engagement" align="right" />
                    </span>
                    <div className="text-sm font-medium text-white">
                      {report.summary.classifications.friendly}
                      <span className="text-[10px] text-zinc-500 ml-1">
                        ({getPercent(report.summary.classifications.friendly)}%)
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-zinc-500/10 rounded border border-zinc-500/20">
                    <span className="text-[10px] text-zinc-400 uppercase flex items-center gap-1">
                      Neutral
                      <InfoTooltip text="Questions, mild disagreement" align="left" />
                    </span>
                    <div className="text-sm font-medium text-white">
                      {report.summary.classifications.neutral}
                      <span className="text-[10px] text-zinc-500 ml-1">
                        ({getPercent(report.summary.classifications.neutral)}%)
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-zinc-800/50 rounded border border-zinc-700">
                    <span className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                      Other
                      <InfoTooltip text="Meta comments + skipped" align="right" />
                    </span>
                    <div className="text-sm font-medium text-white">
                      {report.summary.classifications.meta + report.summary.classifications.skip}
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center p-2 bg-zinc-900/50 rounded">
                  <span className="text-xs text-zinc-400 flex items-center">
                    Avg Effort Ratio
                    <InfoTooltip text="Our reply length ÷ their text length. Lower = more efficient (short punchy reply to long rant)" />
                  </span>
                  <span className="text-sm font-mono text-orange-400">
                    {report.summary.avgEffortRatio.toFixed(2)}x
                  </span>
                </div>

                <div className="flex justify-between items-center p-2 bg-zinc-900/50 rounded">
                  <span className="text-xs text-zinc-400 flex items-center">
                    Engagement Rate
                    <InfoTooltip text="% of our replies that got follow-up responses (triggered someone to reply back)" />
                  </span>
                  <span className="text-sm font-mono text-emerald-400">
                    {report.summary.engagement?.rate || 0}%
                  </span>
                </div>
              </div>
            </SpotlightCard>

            {/* Top Patterns */}
            <SpotlightCard className="p-6 flex-1 flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-200 flex items-center">
                  Top Patterns
                  <InfoTooltip text="Attack types detected (projection, dismissal, etc.)" />
                </h3>
              </div>

              {report.patterns.length === 0 ? (
                <div className="text-center py-4 text-zinc-500 text-xs">No patterns detected</div>
              ) : (
                <div className="space-y-2">
                  {report.patterns.map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between p-2 bg-zinc-900/50 rounded">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-600 w-4">{i + 1}.</span>
                        <span className="text-xs text-zinc-300">{p.name}</span>
                      </div>
                      <span className="text-xs font-mono text-orange-400">{p.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </SpotlightCard>
          </div>

          {/* Right Column - Comparison & Trends */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            {/* Comparison Card */}
            <SpotlightCard className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-zinc-500" />
                  <h3 className="text-sm font-medium text-zinc-200">Comparison</h3>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setComparePeriod('yesterday')}
                    className={`px-2 py-1 text-[10px] rounded ${
                      comparePeriod === 'yesterday'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    vs Yesterday
                  </button>
                  <button
                    onClick={() => setComparePeriod('lastweek')}
                    className={`px-2 py-1 text-[10px] rounded ${
                      comparePeriod === 'lastweek'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    vs Last Week
                  </button>
                </div>
              </div>

              {report.comparison ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-zinc-900/50 rounded border border-zinc-800">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendIcon value={report.comparison.replyDelta} />
                      <span className="text-[10px] text-zinc-500 flex items-center">
                        Replies
                        <InfoTooltip text="Change vs comparison period" align="left" />
                      </span>
                    </div>
                    <div className="text-lg font-semibold">
                      <TrendValue value={report.comparison.replyDelta} />
                    </div>
                    <div className="text-[10px] text-zinc-600">
                      <TrendValue value={report.comparison.replyPercent} suffix="%" />
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/50 rounded border border-zinc-800">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendIcon value={-report.comparison.effortDelta} />
                      <span className="text-[10px] text-zinc-500 flex items-center">
                        Effort Ratio
                        <InfoTooltip text="Length ratio change. Negative = shorter replies" align="left" />
                      </span>
                    </div>
                    <div className="text-lg font-semibold">
                      <TrendValue value={report.comparison.effortDelta} invert />
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/50 rounded border border-zinc-800">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendIcon value={report.comparison.engagementDelta} />
                      <span className="text-[10px] text-zinc-500 flex items-center">
                        Engagement
                        <InfoTooltip text="Engagement rate change (% of replies that triggered follow-up)" align="right" />
                      </span>
                    </div>
                    <div className="text-lg font-semibold">
                      <TrendValue value={report.comparison.engagementDelta} suffix="%" />
                    </div>
                  </div>

                  <div className="p-3 bg-orange-500/5 rounded border border-orange-500/20">
                    <div className="flex items-center gap-1 mb-1">
                      <TrendIcon value={report.comparison.triggeredDelta || 0} />
                      <span className="text-[10px] text-orange-400 flex items-center">
                        🎯 Baits Raged
                        <InfoTooltip text="Change in triggered responses" align="right" />
                      </span>
                    </div>
                    <div className="text-lg font-semibold">
                      <TrendValue value={report.comparison.triggeredDelta || 0} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 text-sm">
                  No comparison data available
                </div>
              )}
            </SpotlightCard>

            {/* Weekly Trend Chart */}
            <SpotlightCard className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-200 flex items-center">
                  Weekly Trend
                  <InfoTooltip text="Daily reply volume over last 7 days" />
                </h3>
                <span className="text-[10px] text-zinc-500 ml-auto">Last 7 days</span>
              </div>

              {report.weeklyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={report.weeklyTrend}>
                    <XAxis
                      dataKey="date"
                      tick={{ fill: '#71717a', fontSize: 10 }}
                      axisLine={{ stroke: '#27272a' }}
                      tickLine={false}
                      tickFormatter={(val) => val.slice(5)} // MM-DD
                    />
                    <YAxis
                      tick={{ fill: '#71717a', fontSize: 10 }}
                      axisLine={{ stroke: '#27272a' }}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                      labelStyle={{ color: '#a1a1aa' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={{ fill: '#f97316', strokeWidth: 0, r: 4 }}
                      activeDot={{ r: 6, fill: '#f97316' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[180px] flex items-center justify-center text-zinc-500 text-sm">
                  No trend data available
                </div>
              )}
            </SpotlightCard>

            {/* Best Hours */}
            <SpotlightCard className="p-6 flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-zinc-500" />
                <h3 className="text-sm font-medium text-zinc-200 flex items-center">
                  Best Hours Today
                  <InfoTooltip text="Hours with most engagement activity" />
                </h3>
              </div>

              {report.bestHours.length === 0 ? (
                <div className="text-center py-4 text-zinc-500 text-xs">No hourly data</div>
              ) : (
                <div className="flex gap-3">
                  {report.bestHours.map((h, i) => (
                    <div
                      key={h.hour}
                      className={`flex-1 p-3 rounded border ${
                        i === 0
                          ? 'bg-orange-500/10 border-orange-500/20'
                          : 'bg-zinc-900/50 border-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        {i === 0 && <span className="text-orange-400">🔥</span>}
                        {i === 1 && <span className="text-zinc-400">📈</span>}
                        {i === 2 && <span className="text-zinc-500">📊</span>}
                        <span className={`text-[10px] ${i === 0 ? 'text-orange-400' : 'text-zinc-500'}`}>
                          {i === 0 ? 'Peak' : i === 1 ? 'High' : 'Active'}
                        </span>
                      </div>
                      <div className="text-lg font-semibold text-white">
                        {h.hour}:00
                      </div>
                      <div className="text-[10px] text-zinc-600">
                        {h.count} replies
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SpotlightCard>
          </div>
        </div>
      )}

      {/* Narrative Summary */}
      {report?.narrative && (
        <SpotlightCard className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-medium text-zinc-200">Daily Vibes</h3>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {report.narrative}
          </p>
        </SpotlightCard>
      )}

      {/* Footer */}
      {report && (
        <div className="flex items-center justify-between text-[10px] text-zinc-600 p-3 bg-zinc-900/30 rounded border border-zinc-800/50">
          <span>
            Last generated: {new Date(report.generatedAt).toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => exportReport.mutate({ date: selectedDate, format: 'json' })}
              className="hover:text-orange-400"
            >
              Export JSON
            </button>
            <span className="text-zinc-700">|</span>
            <button
              onClick={() => exportReport.mutate({ date: selectedDate, format: 'csv' })}
              className="hover:text-orange-400"
            >
              Export CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
