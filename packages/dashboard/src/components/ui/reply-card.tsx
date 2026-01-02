import { SpotlightCard } from './spotlight-card';
import { Button } from './button';
import { Badge } from './badge';
import { Check, X, Twitter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReplyData } from '@/hooks/useReplies';

interface ReplyCardProps {
    reply: ReplyData;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
    showActions?: boolean;
}

export function ReplyCard({ reply, onApprove, onReject, showActions = true }: ReplyCardProps) {
    const isHostile = reply.classification === 'hostile';

    return (
        <SpotlightCard className="p-0 overflow-hidden group/card">
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-white/10 min-h-[180px]">

                {/* LEFT: Their Post (Context) */}
                <div className="p-6 relative flex flex-col justify-between bg-zinc-950/50">
                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent via-red-500/20 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity" />

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="text-xs font-bold text-zinc-400">@{reply.hostile.user}</div>
                                {reply.isFriend && <Badge variant="secondary" className="text-[10px] h-4">Friend</Badge>}
                            </div>
                            <Twitter className="w-4 h-4 text-zinc-600" />
                        </div>

                        <p className="text-sm text-zinc-300 leading-relaxed font-medium">
                            "{reply.hostile.text}"
                        </p>
                    </div>

                    <div className="mt-4 flex items-center gap-2">
                        <Badge variant="outline" className={cn(
                            "text-[10px] uppercase tracking-wider border-none bg-zinc-900",
                            isHostile ? "text-red-400" : "text-emerald-400"
                        )}>
                            {reply.classification}
                        </Badge>
                        <span className="text-[10px] text-zinc-600 font-mono">
                            CONF: {(reply.confidence * 100).toFixed(0)}%
                        </span>
                    </div>
                </div>

                {/* RIGHT: Our Reply (Action) */}
                <div className="p-6 relative flex flex-col justify-between bg-zinc-900/20">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-1 rounded bg-orange-500/10">
                                    <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                                </div>
                                <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">Generated Response</span>
                            </div>
                        </div>

                        <p className="text-sm text-white leading-relaxed font-mono">
                            {reply.our.text}
                        </p>
                    </div>

                    {showActions && (
                        <div className="mt-6 flex gap-3 opacity-60 group-hover/card:opacity-100 transition-all duration-300 translate-y-2 group-hover/card:translate-y-0">
                            <Button
                                className="flex-1 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-400 border border-emerald-500/20"
                                size="sm"
                                onClick={() => onApprove(reply.id)}
                            >
                                <Check className="w-4 h-4 mr-2" />
                                Approve
                            </Button>
                            <Button
                                className="flex-1 bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-400 border border-red-500/20"
                                variant="outline"
                                size="sm"
                                onClick={() => onReject(reply.id)}
                            >
                                <X className="w-4 h-4 mr-2" />
                                Reject
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </SpotlightCard>
    );
}
