import { useStats } from '@/hooks/useStats';
import { useReplies } from '@/hooks/useReplies';
import { ReplyCard } from '@/components/ui/reply-card';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { useSocket } from '@/hooks/useSocket';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, MessageCircle, Filter, Shield, ShieldAlert } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export default function Replies() {
    const { data: stats } = useStats();
    const { data: repliesData, isLoading, refetch, approve, reject } = useReplies(50);
    const { isConnected } = useSocket();

    const toggleApprovalMode = async (enabled: boolean) => {
        await fetch('/api/approval-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        // Stats will update via socket, but we can optimistically re-fetch if needed
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-20">
                <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
            </div>
        );
    }

    if (!repliesData?.samples || repliesData.samples.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
                <SpotlightCard className="p-8 flex flex-col items-center max-w-md">
                    <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
                        <MessageCircle className="w-8 h-8 text-zinc-600" />
                    </div>
                    <h2 className="text-xl font-semibold text-white">No Replies Pending</h2>
                    <p className="text-zinc-400 mt-2 text-sm">
                        The agent is monitoring incoming traffic. New hostile tweets will appear here for review.
                    </p>
                    <Button variant="outline" className="mt-6" onClick={() => refetch()}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Check Again
                    </Button>
                </SpotlightCard>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto pb-20">
            {/* Header / Config */}
            <div className="flex items-center justify-between sticky top-0 z-20 bg-background/80 backdrop-blur-md py-4 -mx-4 px-4 border-b border-white/5">
                <div>
                    <h1 className="text-2xl font-semibold text-white tracking-tight">Replies Feed</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-mono text-zinc-500">
                            {repliesData.total} PENDING ITEMS
                        </span>
                        {isConnected && (
                            <span className="flex items-center gap-1 text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                LIVE
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-white/5">
                        {stats?.approvalRequired ? (
                            <Shield className="w-3 h-3 text-orange-500" />
                        ) : (
                            <ShieldAlert className="w-3 h-3 text-zinc-600" />
                        )}
                        <span className="text-xs text-zinc-400 font-medium">Approval Mode</span>
                        <Switch
                            checked={stats?.approvalRequired ?? true}
                            onCheckedChange={toggleApprovalMode}
                            className="scale-75"
                        />
                    </div>

                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white">
                            <Filter className="w-4 h-4 mr-2" />
                            Filter: All
                        </Button>
                        <Button variant="default" size="sm" onClick={() => refetch()} className="bg-orange-500 hover:bg-orange-600 text-white border-none">
                            <RefreshCw className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Feed */}
            <div className="space-y-4">
                <AnimatePresence mode='popLayout'>
                    {repliesData.samples.map((reply) => (
                        <motion.div
                            key={reply.id}
                            layout
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                        >
                            <ReplyCard
                                reply={reply}
                                onApprove={() => approve(reply.id)}
                                onReject={() => reject(reply.id)}
                                showActions={stats?.approvalRequired ?? true}
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            <div className="text-center pt-8 pb-4">
                <p className="text-xs text-zinc-600 font-mono uppercase tracking-widest">End of Feed</p>
            </div>
        </div>
    );
}
