import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface SearchResult {
  text: string;
  source: string;
  score: number;
}

export function useSources() {
  return useQuery({
    queryKey: ['docs', 'sources'],
    queryFn: async () => {
      const res = await fetch('/api/research/sources');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.sources as string[];
    },
  });
}

export function useIngestUrl() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ url, sourceName }: { url: string; sourceName: string }) => {
      const res = await fetch('/api/research/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: url, sourceName }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs', 'sources'] });
    },
  });
}

export function useIngestText() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ text, sourceName }: { text: string; sourceName: string }) => {
      const res = await fetch('/api/research/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: `text://${sourceName}`, sourceName, rawText: text }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs', 'sources'] });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sourceName: string) => {
      const res = await fetch(`/api/research/sources/${encodeURIComponent(sourceName)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs', 'sources'] });
    },
  });
}

export function useSearchAmmo() {
  return useMutation({
    mutationFn: async ({ query, topK = 5 }: { query: string; topK?: number }) => {
      const res = await fetch('/api/research/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.results as SearchResult[];
    },
  });
}
