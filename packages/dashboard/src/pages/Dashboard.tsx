import { useState } from 'react';
import { useStats } from '@/hooks/useStats';
import { useReplies } from '@/hooks/useReplies';
import { useHourlyDistribution } from '@/hooks/useAnalytics';
import { useUpdateClassifications, ClassificationType } from '@/hooks/useFocusedPosts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import {
    MessageCircle,
    AlertTriangle,
    Clock,
    Users,
    Play,
    Pause,
    RotateCw,
    Zap,
    Target,
    Globe,
    X,
    ExternalLink,
    Filter,
    Flame,
    Sparkles,
    Scale,
    Power,
    Terminal,
    Send,
    Loader2,
    Eye,
    TrendingUp,
    Percent,
    Activity
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import millify from 'millify';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type ReplyModeType = 'all' | 'hostile_only' | 'friendly_only' | 'match_energy';

interface ReplyModeData {
    success: boolean;
    replyMode: ReplyModeType;
    isFocusMode: boolean;
    description: string;
}

interface FocusData {
    success: boolean;
    mode: 'focused' | 'general';
    postIds: string[];
    posts?: Array<{
        id: string;
        text: string;
        urls?: {
            permalinkCom?: string;
            permalinkNet: string;
            shortcode?: string;
        };
        targetClassifications?: ClassificationType[];
    }>;
    hasPausedPosts?: boolean;
    pausedPostCount?: number;
}

export default function Dashboard() {
    const { data: stats, isLoading } = useStats();
    const { data: repliesData } = useReplies(10);
    const { data: hourlyData } = useHourlyDistribution();
    const queryClient = useQueryClient();
    const updateClassifications = useUpdateClassifications();

    // Focus mode state
    const [focusInput, setFocusInput] = useState('');
    const [isSettingFocus, setIsSettingFocus] = useState(false);

    // Fetch current focus status
    const { data: focusData } = useQuery<FocusData>({
        queryKey: ['focus'],
        queryFn: async () => {
            const res = await fetch('/api/focus');
            return res.json();
        },
        refetchInterval: 10000
    });

    // Fetch current reply mode
    const { data: replyModeData } = useQuery<ReplyModeData>({
        queryKey: ['reply-mode'],
        queryFn: async () => {
            const res = await fetch('/api/reply-mode');
            return res.json();
        },
        refetchInterval: 10000
    });

    // Fetch logs
    const { data: logsData } = useQuery<{ success: boolean; logs: Array<{ timestamp: string; level: string; message: string }> }>({
        queryKey: ['logs'],
        queryFn: async () => {
            const res = await fetch('/api/logs?limit=30');
            return res.json();
        },
        refetchInterval: 3000
    });

    // Mutation to set reply mode
    const setReplyModeMutation = useMutation({
        mutationFn: async (mode: ReplyModeType) => {
            const res = await fetch('/api/reply-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['reply-mode'] });
        }
    });

    // Force respond to specific reply
    const [forceRespondingId, setForceRespondingId] = useState<string | null>(null);
    const forceRespondMutation = useMutation({
        mutationFn: async (replyId: string) => {
            setForceRespondingId(replyId);
            const res = await fetch(`/api/force-respond/${encodeURIComponent(replyId)}`, {
                method: 'POST'
            });
            return res.json();
        },
        onSuccess: (data) => {
            setForceRespondingId(null);
            if (data.success) {
                queryClient.invalidateQueries({ queryKey: ['replies'] });
                queryClient.invalidateQueries({ queryKey: ['stats'] });
            } else {
                alert(data.error || 'Failed to force respond');
            }
        },
        onError: () => {
            setForceRespondingId(null);
        }
    });

    // Force check state
    const [isForceChecking, setIsForceChecking] = useState(false);

    // Transform hourly data for chart
    const chartData = hourlyData?.map((count, hour) => ({
        hour: `${hour}:00`,
        replies: count,
    })) || [];

    // Get recent activity from replies
    const recentActivity = repliesData?.samples?.slice(0, 5) || [];

    // Focus mode handlers
    const handleSetFocus = async () => {
        if (!focusInput.trim()) return;
        setIsSettingFocus(true);
        try {
            // Split by newlines or commas to support multiple URLs
            const urls = focusInput.split(/[\n,]+/).map(u => u.trim()).filter(u => u);
            const res = await fetch('/api/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            });
            const data = await res.json();
            if (data.success) {
                setFocusInput('');
                queryClient.invalidateQueries({ queryKey: ['focus'] });
            } else {
                alert(data.error || 'Failed to set focus');
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsSettingFocus(false);
        }
    };

    const handlePauseFocus = async () => {
        try {
            await fetch('/api/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pause: true })
            });
            queryClient.invalidateQueries({ queryKey: ['focus'] });
        } catch (e) {
            console.error(e);
        }
    };

    const handleResumeFocus = async () => {
        try {
            await fetch('/api/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resume: true })
            });
            queryClient.invalidateQueries({ queryKey: ['focus'] });
        } catch (e) {
            console.error(e);
        }
    };

    const handleRemoveFocus = async (idToRemove: string) => {
        try {
            const res = await fetch('/api/focus', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ remove: idToRemove })
            });
            const data = await res.json();
            if (data.success) {
                queryClient.invalidateQueries({ queryKey: ['focus'] });
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Handlers
    const handlePause = async () => {
        const isPaused = stats?.status === 'paused';
        try {
            await fetch('/api/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paused: !isPaused })
            });
            queryClient.setQueryData(['stats'], (old: any) => ({
                ...old,
                status: !isPaused ? 'paused' : 'active'
            }));
        } catch (e) {
            console.error(e);
        }
    };

    const handleRestart = async () => {
        if (!confirm('Restart the agent? This will temporarily disconnect.')) return;
        try {
            await fetch('/api/restart', { method: 'POST' });
            queryClient.setQueryData(['stats'], (old: any) => ({
                ...old,
                status: 'restarting'
            }));
        } catch (e) {
            console.error(e);
        }
    };

    const handleForceCheck = async (bypassPause: boolean = false) => {
        try {
            setIsForceChecking(true);
            const res = await fetch('/api/force-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bypassPause })
            });
            const data = await res.json();
            if (data.success) {
                queryClient.invalidateQueries({ queryKey: ['replies'] });
                queryClient.invalidateQueries({ queryKey: ['stats'] });
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsForceChecking(false);
        }
    };

    if (isLoading) return null;

    const statItems = [
        { title: "Total Engagement", value: stats?.repliesHandled || 0, icon: MessageCircle },
        { title: "Pending Review", value: stats?.pendingReview || 0, icon: AlertTriangle },
        { title: "Active Limitations", value: stats?.activeCoolffs || 0, icon: Clock },
        { title: "Friends", value: stats?.friendCount || 0, icon: Users },
    ];

    const performanceItems = [
        { title: "Views (24h)", value: stats?.dailyViews || 0, icon: Eye, suffix: "" },
        { title: "Views (1h)", value: stats?.hourlyViews || 0, icon: TrendingUp, suffix: "" },
        { title: "Engagement", value: `${(stats?.engagementRatio || 0).toFixed(1)}%`, icon: Percent, isText: true },
        { title: "API Usage", value: `${stats?.dailyRepliesSent || 0}/${stats?.dailyReplyLimit || 50}`, icon: Activity, isText: true },
    ];

    // Format timestamp
    const formatTime = (ts: number) => {
        const date = new Date(ts);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="space-y-8">

            {/* Hero / Header */}
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">
                        Dashboard
                    </h1>
                    <p className="text-muted-foreground text-sm max-w-lg">
                        Monitor real-time agent performance, reply throughput, and operational status.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Uptime */}
                    <div className="px-3 py-1.5 bg-zinc-900/50 border border-zinc-800 rounded-md">
                        <span className="text-[10px] text-zinc-500 mr-2">UPTIME</span>
                        <span className="text-xs font-mono text-zinc-300">
                            {Math.floor((stats?.uptime || 0) / 3600)}h {Math.floor(((stats?.uptime || 0) % 3600) / 60)}m
                        </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={handlePause} className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-xs gap-2">
                        {stats?.status === 'paused' ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                        {stats?.status === 'paused' ? "Resume" : "Pause"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleRestart} className="bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-xs gap-2">
                        <Power className="w-3 h-3" />
                        Restart
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleForceCheck(stats?.status === 'paused')}
                        disabled={isForceChecking}
                        className={`bg-zinc-900 border-zinc-800 hover:bg-zinc-800 text-xs gap-2 ${stats?.status === 'paused' ? 'border-orange-500/50 text-orange-400 hover:text-orange-300' : ''}`}
                    >
                        {isForceChecking ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <RotateCw className="w-3 h-3" />
                        )}
                        {stats?.status === 'paused' ? 'Force Check' : 'Sync'}
                    </Button>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {statItems.map((item, i) => (
                    <SpotlightCard key={i} className="p-6 h-32 flex flex-col justify-between">
                        <div className="flex justify-between items-start">
                            <span className="text-zinc-400 text-sm font-medium">{item.title}</span>
                            <item.icon className="w-4 h-4 text-zinc-600" />
                        </div>
                        <div className="text-3xl font-semibold text-white tracking-tight">
                            {millify(item.value)}
                        </div>
                    </SpotlightCard>
                ))}
            </div>

            {/* Performance Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {performanceItems.map((item, i) => (
                    <SpotlightCard key={i} className="p-6 h-32 flex flex-col justify-between">
                        <div className="flex justify-between items-start">
                            <span className="text-zinc-400 text-sm font-medium">{item.title}</span>
                            <item.icon className="w-4 h-4 text-emerald-500" />
                        </div>
                        <div className="text-3xl font-semibold text-white tracking-tight">
                            {'isText' in item && item.isText ? item.value : millify(item.value as number)}
                        </div>
                    </SpotlightCard>
                ))}
            </div>

            {/* Main Content Areas */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

                {/* Activity Overview - Chart + Feed */}
                <div className="flex flex-col gap-6">
                    {/* Hourly Activity Chart */}
                    <SpotlightCard className="p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-medium text-zinc-200">Hourly Activity</h3>
                            <span className="text-[10px] text-zinc-500 font-mono">LAST 24H</span>
                        </div>
                        {chartData.length > 0 && chartData.some(d => d.replies > 0) ? (
                            <ResponsiveContainer width="100%" height={180}>
                                <BarChart data={chartData}>
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
                                        width={30}
                                    />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                                        labelStyle={{ color: '#a1a1aa' }}
                                    />
                                    <Bar dataKey="replies" fill="#f97316" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[180px] flex items-center justify-center text-zinc-500 text-sm">
                                No activity data yet
                            </div>
                        )}
                    </SpotlightCard>

                    {/* Recent Activity Feed */}
                    <SpotlightCard className="p-6 flex-1 flex flex-col">
                        <div className="flex items-center gap-2 mb-4">
                            <Zap className="w-4 h-4 text-orange-500" />
                            <h3 className="text-sm font-medium text-zinc-200">Recent Activity</h3>
                        </div>
                        {recentActivity.length > 0 ? (
                            <div className="space-y-3 flex-1 overflow-y-auto">
                                {recentActivity.map((reply) => (
                                    <div key={reply.id} className="flex gap-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/50 group">
                                        <div className={`w-1 rounded-full flex-shrink-0 ${reply.classification === 'hostile' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs font-medium text-zinc-400">@{reply.hostile.user}</span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${reply.classification === 'hostile' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                                    {reply.classification}
                                                </span>
                                                <span className="text-[10px] text-zinc-600 ml-auto">{formatTime(reply.timestamp)}</span>
                                            </div>
                                            <p className="text-xs text-zinc-500 truncate">{reply.hostile.text}</p>
                                            <p className="text-xs text-orange-400/80 truncate mt-1">→ {reply.our.text}</p>
                                        </div>
                                        {/* Force respond button - only show for replies we haven't responded to yet */}
                                        {!reply.our.text && (
                                            <button
                                                onClick={() => forceRespondMutation.mutate(reply.hostile.id)}
                                                disabled={forceRespondingId === reply.hostile.id}
                                                className="self-center p-1.5 text-zinc-600 hover:text-orange-400 hover:bg-orange-500/10 rounded transition-all opacity-0 group-hover:opacity-100 disabled:opacity-100"
                                                title="Force respond to this reply"
                                            >
                                                {forceRespondingId === reply.hostile.id ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400" />
                                                ) : (
                                                    <Send className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
                                No recent activity
                            </div>
                        )}
                    </SpotlightCard>
                </div>

                {/* Side Panel */}
                <div className="flex flex-col gap-6">

                    {/* Connect Threads Button */}
                    <SpotlightCard className="p-6">
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="text-sm font-medium text-zinc-200">Meta Verification</h3>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-zinc-800 text-zinc-500">
                                BETA
                            </span>
                        </div>
                        <p className="text-xs text-zinc-500 mb-4">
                            Connect your Threads account to enable auto-replies and verification status.
                        </p>
                        <Button
                            className="w-full bg-[#101010] hover:bg-[#1a1a1a] text-white border border-zinc-800"
                            onClick={() => {
                                // Redirect to API auth endpoint
                                // Pass a dummy state or the current user ID if available
                                window.location.href = '/api/auth/threads?state=default_account';
                            }}
                        >
                            <span className="mr-2">@</span> Connect Threads
                        </Button>
                    </SpotlightCard>

                    {/* Focus Mode Control */}
                    <SpotlightCard className={`p-6 ${focusData?.mode === 'focused' ? 'flex-1 flex flex-col' : ''}`}>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                {focusData?.mode === 'focused' ? (
                                    <Target className="w-4 h-4 text-orange-500" />
                                ) : (
                                    <Globe className="w-4 h-4 text-zinc-500" />
                                )}
                                <h3 className="text-sm font-medium text-zinc-200">Focus Mode</h3>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${focusData?.mode === 'focused'
                                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                                : 'bg-zinc-800 text-zinc-500'
                                }`}>
                                {focusData?.mode === 'focused' ? 'FOCUSED' : 'GENERAL'}
                            </span>
                        </div>

                        {/* Current Focus Status */}
                        {focusData?.mode === 'focused' && focusData.postIds.length > 0 && (
                            <div className="mb-4 space-y-2">
                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Monitoring:</p>
                                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                    {focusData.postIds.map((id) => {
                                        const post = focusData.posts?.find(p => p.id === id);
                                        const postText = post?.text || '';
                                        const truncatedText = postText.length > 40 ? postText.slice(0, 40) + '...' : postText;
                                        const postUrl = post?.urls?.permalinkCom || post?.urls?.permalinkNet || `https://www.threads.net/post/${id}`;
                                        const currentClassifications = post?.targetClassifications || ['hostile', 'friendly', 'neutral'];

                                        const toggleClassification = (classification: ClassificationType) => {
                                            const isActive = currentClassifications.includes(classification);
                                            let newClassifications: ClassificationType[];
                                            if (isActive && currentClassifications.length > 1) {
                                                newClassifications = currentClassifications.filter(c => c !== classification);
                                            } else if (!isActive) {
                                                newClassifications = [...currentClassifications, classification];
                                            } else {
                                                return; // Can't remove last classification
                                            }
                                            updateClassifications.mutate({ postId: id, targetClassifications: newClassifications });
                                        };

                                        return (
                                            <div key={id} className="p-2 bg-zinc-900/50 rounded border border-zinc-800 group">
                                                <div className="flex items-center justify-between mb-2">
                                                    <a
                                                        href={postUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-xs font-mono text-zinc-400 hover:text-orange-400 truncate flex-1 flex items-center gap-1.5 transition-colors"
                                                        title={postText || `Post ${id}`}
                                                    >
                                                        <span>{truncatedText || `Post ...${id.slice(-8)}`}</span>
                                                        <ExternalLink className="w-3 h-3 opacity-50 flex-shrink-0" />
                                                    </a>
                                                    <button
                                                        onClick={() => handleRemoveFocus(id)}
                                                        className="ml-2 p-1 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                        title="Remove from focus"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                                {/* Classification targeting toggles */}
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => toggleClassification('hostile')}
                                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                                            currentClassifications.includes('hostile')
                                                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                                                : 'bg-zinc-800 text-zinc-600 border border-zinc-700 hover:border-zinc-600'
                                                        }`}
                                                        title="Toggle hostile replies"
                                                    >
                                                        <Flame className="w-3 h-3 inline mr-1" />
                                                        Hostile
                                                    </button>
                                                    <button
                                                        onClick={() => toggleClassification('friendly')}
                                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                                            currentClassifications.includes('friendly')
                                                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                                                : 'bg-zinc-800 text-zinc-600 border border-zinc-700 hover:border-zinc-600'
                                                        }`}
                                                        title="Toggle friendly replies"
                                                    >
                                                        <Sparkles className="w-3 h-3 inline mr-1" />
                                                        Friendly
                                                    </button>
                                                    <button
                                                        onClick={() => toggleClassification('neutral')}
                                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                                                            currentClassifications.includes('neutral')
                                                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                                : 'bg-zinc-800 text-zinc-600 border border-zinc-700 hover:border-zinc-600'
                                                        }`}
                                                        title="Toggle neutral replies"
                                                    >
                                                        <Scale className="w-3 h-3 inline mr-1" />
                                                        Neutral
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full mt-2 text-xs bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
                                    onClick={handlePauseFocus}
                                >
                                    <Globe className="w-3 h-3 mr-2" />
                                    Switch to General Mode
                                </Button>
                            </div>
                        )}

                        {/* Resume Focus Button - shows when in general mode with paused posts */}
                        {focusData?.mode !== 'focused' && focusData?.hasPausedPosts && (
                            <div className="mb-4">
                                <Button
                                    size="sm"
                                    className="w-full bg-orange-500 hover:bg-orange-600 text-white border-none text-xs"
                                    onClick={handleResumeFocus}
                                >
                                    <Target className="w-3 h-3 mr-2" />
                                    Resume Focus ({focusData.pausedPostCount} posts)
                                </Button>
                                <p className="text-[10px] text-zinc-500 mt-1 text-center">
                                    Your previous focus session is paused
                                </p>
                            </div>
                        )}

                        {/* Input for new focus */}
                        <div className="space-y-2">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
                                {focusData?.mode === 'focused' ? 'Add more posts:' : 'Focus on specific post:'}
                            </p>
                            <Input
                                placeholder="Paste Threads URL or post ID..."
                                value={focusInput}
                                onChange={(e) => setFocusInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSetFocus()}
                                className="bg-zinc-900 border-zinc-800 text-xs h-9"
                            />
                            <p className="text-[10px] text-zinc-600">
                                Supports: threads.net URLs or numeric IDs. Separate multiple with commas.
                            </p>
                            <Button
                                size="sm"
                                className="w-full bg-orange-500 hover:bg-orange-600 text-white border-none text-xs"
                                onClick={handleSetFocus}
                                disabled={!focusInput.trim() || isSettingFocus}
                            >
                                <Target className="w-3 h-3 mr-2" />
                                {isSettingFocus ? 'Setting...' : 'Set Focus'}
                            </Button>
                        </div>
                    </SpotlightCard>

                    {/* Reply Filter - Only visible in general mode */}
                    {focusData?.mode !== 'focused' && (
                        <SpotlightCard className="p-6 flex-1 flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Filter className="w-4 h-4 text-zinc-500" />
                                    <h3 className="text-sm font-medium text-zinc-200">Reply Filter</h3>
                                </div>
                                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-zinc-800 text-zinc-500">
                                    GENERAL MODE
                                </span>
                            </div>

                            <p className="text-[10px] text-zinc-500 mb-3">
                                Choose which replies to respond to:
                            </p>

                            <div className="space-y-2">
                                {/* All Replies */}
                                <button
                                    onClick={() => setReplyModeMutation.mutate('all')}
                                    className={`w-full p-3 rounded-lg border text-left transition-all ${replyModeData?.replyMode === 'all'
                                        ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                                        : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                                        }`}
                                    disabled={setReplyModeMutation.isPending}
                                >
                                    <div className="flex items-center gap-2">
                                        <MessageCircle className="w-4 h-4" />
                                        <span className="text-xs font-medium">All Replies</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-1 ml-6">
                                        Respond to every reply regardless of tone
                                    </p>
                                </button>

                                {/* Hostile Only */}
                                <button
                                    onClick={() => setReplyModeMutation.mutate('hostile_only')}
                                    className={`w-full p-3 rounded-lg border text-left transition-all ${replyModeData?.replyMode === 'hostile_only'
                                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                                        : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                                        }`}
                                    disabled={setReplyModeMutation.isPending}
                                >
                                    <div className="flex items-center gap-2">
                                        <Flame className="w-4 h-4" />
                                        <span className="text-xs font-medium">Hostile Only</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-1 ml-6">
                                        Only respond to hostile/negative replies
                                    </p>
                                </button>

                                {/* Friendly Only */}
                                <button
                                    onClick={() => setReplyModeMutation.mutate('friendly_only')}
                                    className={`w-full p-3 rounded-lg border text-left transition-all ${replyModeData?.replyMode === 'friendly_only'
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                        : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                                        }`}
                                    disabled={setReplyModeMutation.isPending}
                                >
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4" />
                                        <span className="text-xs font-medium">Friendly Only</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-1 ml-6">
                                        Only respond to friendly/positive replies
                                    </p>
                                </button>

                                {/* Match Energy */}
                                <button
                                    onClick={() => setReplyModeMutation.mutate('match_energy')}
                                    className={`w-full p-3 rounded-lg border text-left transition-all ${replyModeData?.replyMode === 'match_energy'
                                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                                        : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                                        }`}
                                    disabled={setReplyModeMutation.isPending}
                                >
                                    <div className="flex items-center gap-2">
                                        <Scale className="w-4 h-4" />
                                        <span className="text-xs font-medium">Match Energy</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-500 mt-1 ml-6">
                                        Respond to hostile & friendly, skip neutral
                                    </p>
                                </button>
                            </div>
                        </SpotlightCard>
                    )}

                </div>
            </div>

            {/* Log Panel */}
            <SpotlightCard className="p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Terminal className="w-4 h-4 text-zinc-500" />
                    <h3 className="text-sm font-medium text-zinc-200">Logs</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-zinc-800 text-zinc-500 ml-auto">
                        LIVE
                    </span>
                </div>
                <div className="bg-black/50 rounded-lg border border-zinc-800 p-3 font-mono text-xs max-h-[200px] overflow-y-auto">
                    {logsData?.logs && logsData.logs.length > 0 ? (
                        <div className="space-y-1">
                            {logsData.logs.slice().reverse().map((log, i) => {
                                const time = new Date(log.timestamp).toLocaleTimeString();
                                const levelColor =
                                    log.level === 'error' ? 'text-red-400' :
                                        log.level === 'warn' ? 'text-yellow-400' :
                                            log.level === 'info' ? 'text-blue-400' :
                                                'text-zinc-500';
                                return (
                                    <div key={i} className="flex gap-2">
                                        <span className="text-zinc-600 flex-shrink-0">{time}</span>
                                        <span className={`${levelColor} w-12 flex-shrink-0 uppercase`}>{log.level}</span>
                                        <span className="text-zinc-400 truncate">{log.message}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-zinc-500 text-center py-4">
                            Waiting for logs...
                        </div>
                    )}
                </div>
            </SpotlightCard>
        </div>
    );
}
