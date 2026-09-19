import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSocket } from './useSocket';

// Achievement Stats Types
interface DailyStats {
    date: string;
    hatersHandled: number;
    wordsSaved: number;
    hostileWordsDeflected: number;
}

interface AchievementStats {
    today: {
        hatersHandled: number;
        minutesSaved: number;
        wordsSaved: number;
        hostileWordsDeflected: number;
    };
    allTime: {
        hatersHandled: number;
        minutesSaved: number;
        wordsSaved: number;
        hostileWordsDeflected: number;
    };
    streak: {
        current: number;
        best: number;
        lastActiveDate: string | null;
    };
    recentDays: DailyStats[];
}

export interface DashboardStats {
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

/**
 * useAchievements - Gamified stats for the achievements popup
 * Shows time saved, haters handled, streaks, etc.
 */
export function useAchievements() {
    return useQuery({
        queryKey: ['stats', 'achievements'],
        queryFn: async () => {
            const res = await fetch('/api/stats/achievements');
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            return data.stats as AchievementStats;
        },
        staleTime: 30000, // 30 seconds
        refetchInterval: 60000, // Refresh every minute
    });
}

export type { AchievementStats, DailyStats };
