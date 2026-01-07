import { useQuery } from '@tanstack/react-query';

interface PatternStats {
  [key: string]: {
    count: number;
    examples: string[];
  };
}

interface ClassificationCounts {
  hostile: number;
  friendly: number;
  neutral: number;
}

interface EffortTrend {
  date: string;
  avgHostileLength: number;
  avgOurLength: number;
}

export function usePatterns() {
  return useQuery({
    queryKey: ['analytics', 'patterns'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/patterns');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.patterns as PatternStats;
    },
    staleTime: 60000,
  });
}

export function useClassifications() {
  return useQuery({
    queryKey: ['analytics', 'classifications'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/classifications');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.classifications as ClassificationCounts;
    },
    staleTime: 60000,
  });
}

export function useHourlyDistribution() {
  return useQuery({
    queryKey: ['analytics', 'hours'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/hours');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.replyDistribution as number[];
    },
    staleTime: 60000,
  });
}

export function useEffortTrends(days: number = 14) {
  return useQuery({
    queryKey: ['analytics', 'effort', days],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/effort-trends?days=${days}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.trends as EffortTrend[];
    },
    staleTime: 60000,
  });
}

// Ghost Analytics Types
interface GhostBaseline {
  avgVelocity1h: string;
  avgVelocity6h: string;
  avgVelocity24h: string;
  avgEngagementRate: string;
  sampleCount: number;
  hasEnoughData: boolean;
}

interface GhostPost {
  postId: string;
  text: string;
  postedAt: string;
  views: number;
  likes: number;
  replies: number;
  engagementRate: string | null;
  velocityVsAvg: string | null;
  engagementVsAvg: string | null;
  isHot: boolean;
  isEvergreen: boolean;
}

interface HourlyTrend {
  hour: string;
  totalViews: number;
  avgVelocity: string;
}

interface EvergreenCandidate {
  postId: string;
  text: string;
  postedAt: string;
  engagementRate: string | null;
  views: number;
}

export interface GhostAnalytics {
  baseline: GhostBaseline;
  topPosts: GhostPost[];
  hourlyTrend: HourlyTrend[];
  evergreenCandidates: EvergreenCandidate[];
  hasData: boolean;
}

export function useGhostAnalytics() {
  return useQuery({
    queryKey: ['analytics', 'ghost'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/ghost');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.ghost as GhostAnalytics;
    },
    staleTime: 60000,
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}
