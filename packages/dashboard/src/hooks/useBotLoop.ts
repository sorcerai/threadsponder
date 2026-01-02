import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface GlobalRate {
  currentRate: number;
  maxPerHour: number;
  percentUsed: string;
  status: 'ok' | 'warning' | 'throttled';
}

interface Cooloff {
  username: string;
  remainingSeconds: number;
}

interface DepthEntry {
  username: string;
  depth: number;
}

interface UserStats {
  username: string;
  inCooloff: boolean;
  recentReplies: number;
  totalInteractions: number;
  conversationDepths: { convId: string; depth: number }[];
  recentInteractions: { theirText: string; ourText: string }[];
}

export function useGlobalRate() {
  return useQuery({
    queryKey: ['botloop', 'global-rate'],
    queryFn: async () => {
      const res = await fetch('/api/botloop/global-rate');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data as GlobalRate;
    },
    refetchInterval: 30000,
  });
}

export function useCooloffs() {
  return useQuery({
    queryKey: ['botloop', 'cooloffs'],
    queryFn: async () => {
      const res = await fetch('/api/botloop/cooloffs');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.cooloffs as Cooloff[];
    },
    refetchInterval: 30000,
  });
}

export function useDepths() {
  return useQuery({
    queryKey: ['botloop', 'depths'],
    queryFn: async () => {
      const res = await fetch('/api/botloop/depths');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.depths as DepthEntry[];
    },
    refetchInterval: 60000,
  });
}

export function useUserLookup(username: string, enabled: boolean = false) {
  return useQuery({
    queryKey: ['botloop', 'user', username],
    queryFn: async () => {
      const res = await fetch(`/api/botloop/user/${encodeURIComponent(username)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data as UserStats;
    },
    enabled: enabled && !!username,
  });
}

export function useClearCooloff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/botloop/cooloff/${encodeURIComponent(username)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['botloop', 'cooloffs'] });
    },
  });
}

export function useResetUserLimits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/botloop/user/${encodeURIComponent(username)}/reset`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['botloop'] });
    },
  });
}
