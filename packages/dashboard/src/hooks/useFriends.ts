import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

type FriendMode = 'friendly' | 'banter' | 'roast';

interface Friend {
  username: string;
  mode: FriendMode;
}

interface Suggestion {
  username: string;
  count: number;
  friendlyRatio: number;
}

export function useFriends() {
  return useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      const res = await fetch('/api/friends');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return { friends: data.friends as Friend[], count: data.count as number };
    },
  });
}

export function useSuggestions() {
  return useQuery({
    queryKey: ['friends', 'suggestions'],
    queryFn: async () => {
      const res = await fetch('/api/friends/suggestions');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.suggestions as Suggestion[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useAddFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ username, mode }: { username: string; mode: FriendMode }) => {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, mode }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useRemoveFriend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/friends/${encodeURIComponent(username)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useUpdateFriendMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ username, mode }: { username: string; mode: FriendMode }) => {
      const res = await fetch(`/api/friends/${encodeURIComponent(username)}/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useAcceptSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/friends/suggestions/${encodeURIComponent(username)}/accept`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export function useRejectSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (username: string) => {
      const res = await fetch(`/api/friends/suggestions/${encodeURIComponent(username)}/reject`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends', 'suggestions'] });
    },
  });
}
