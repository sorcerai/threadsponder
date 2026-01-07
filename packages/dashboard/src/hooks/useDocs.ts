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

// Voice document types
interface VoiceDocument {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunks_processed: number | null;
  examples_created: number | null;
  error_message: string | null;
  created_at: string;
}

/**
 * List voice training documents
 */
export function useVoiceDocuments() {
  return useQuery({
    queryKey: ['voice', 'documents'],
    queryFn: async () => {
      const res = await fetch('/api/voice/documents');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.documents as VoiceDocument[];
    },
    refetchInterval: 5000, // Poll for status updates
  });
}

/**
 * Upload a file for voice training
 */
export function useUploadVoiceDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const res = await fetch('/api/voice/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          fileSize: file.size,
          fileData: base64,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice', 'documents'] });
    },
  });
}

/**
 * Delete a voice document
 */
export function useDeleteVoiceDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch(`/api/voice/documents/${documentId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice', 'documents'] });
    },
  });
}
