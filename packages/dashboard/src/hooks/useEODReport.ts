import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface EODReport {
  date: string;
  generatedAt: number;
  summary: {
    totalReplies: number;
    triggered: number;  // "Baits raged" - hostile replies to our replies
    classifications: {
      hostile: number;
      friendly: number;
      neutral: number;
      meta: number;
      skip: number;
    };
    avgEffortRatio: number;
    engagement: {
      rate: number;           // % of our replies that got engagement
      totalLikes: number;     // Total likes across all our replies
      avgLikes: number;       // Average likes per reply
      totalReplies: number;   // Total replies received on our posts
    };
  };
  patterns: Array<{ name: string; count: number }>;
  bestHours: Array<{ hour: number; count: number }>;
  comparison?: {
    period: 'yesterday' | 'lastweek';
    replyDelta: number;
    replyPercent: number;
    effortDelta: number;
    engagementDelta: number;
    triggeredDelta: number;
  };
  weeklyTrend: Array<{ date: string; count: number }>;
  narrative?: string;
}

interface EODReportResponse {
  success: boolean;
  report: EODReport;
  regenerated?: boolean;
  error?: string;
}

interface HistoryResponse {
  success: boolean;
  dates: string[];
  count: number;
}

export function useEODReport(date?: string, compare: 'yesterday' | 'lastweek' = 'yesterday') {
  const queryClient = useQueryClient();

  const query = useQuery<EODReportResponse>({
    queryKey: ['eod-report', date, compare],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (date) params.append('date', date);
      params.append('compare', compare);

      const res = await fetch(`/api/reports/eod?${params}`);
      if (!res.ok) throw new Error('Failed to fetch EOD report');
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000
  });

  const generateMutation = useMutation({
    mutationFn: async (targetDate?: string) => {
      const res = await fetch('/api/reports/eod/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: targetDate })
      });
      if (!res.ok) throw new Error('Failed to generate report');
      return res.json() as Promise<EODReportResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eod-report'] });
      queryClient.invalidateQueries({ queryKey: ['eod-history'] });
    }
  });

  return {
    ...query,
    report: query.data?.report,
    generate: generateMutation.mutate,
    isGenerating: generateMutation.isPending
  };
}

export function useEODHistory(limit: number = 7) {
  return useQuery<HistoryResponse>({
    queryKey: ['eod-history', limit],
    queryFn: async () => {
      const res = await fetch(`/api/reports/eod/history?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch report history');
      return res.json();
    }
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: async ({ date, format }: { date?: string; format: 'json' | 'csv' }) => {
      const params = new URLSearchParams();
      if (date) params.append('date', date);
      params.append('format', format);

      const res = await fetch(`/api/reports/eod/export?${params}`);
      if (!res.ok) throw new Error('Failed to export report');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eod-report-${date || 'today'}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  });
}
