import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSocket } from './useSocket';

interface DashboardStats {
    status: string;
    uptime: number;
    repliesHandled: number;
    pendingReview: number;
    activeCoolffs: number;
    friendCount: number;
    documentSources: number;
    approvalRequired: boolean;
    // Performance metrics
    dailyViews: number;
    hourlyViews: number;
    engagementRatio: number;
    // API usage limits
    dailyRepliesSent: number;
    dailyReplyLimit: number;
}

export function useStats() {
    const { socket } = useSocket();
    const queryClient = useQueryClient();

    // Initial fetch
    const query = useQuery({
        queryKey: ['stats'],
        queryFn: async () => {
            const res = await fetch('/api/overview');
            const data = await res.json();
            return data.overview as DashboardStats;
        },
        refetchInterval: 60000, // Fallback polling
    });

    // Real-time updates
    useEffect(() => {
        if (!socket) return;

        // Listen for status updates
        socket.on('status-update', (data: Partial<DashboardStats>) => {
            queryClient.setQueryData(['stats'], (old: DashboardStats | undefined) => {
                if (!old) return old;
                return { ...old, ...data };
            });
        });

        socket.on('reply-posted', () => {
            queryClient.invalidateQueries({ queryKey: ['stats'] });
            // optimized: could manually increment repliesHandled here
        });

        return () => {
            socket.off('status-update');
            socket.off('reply-posted');
        };
    }, [socket, queryClient]);

    return query;
}
