import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface CharacterConfig {
  name: string;
  description: string;
  modelProvider: string;
  clients: string[];
  bio: string[];
  lore: string[];
  topics: string[];
  adjectives: string[];
  style: {
    all: string[];
    hostile: string[];
    friendly: string[];
    neutral: string[];
    meta: string[];
  };
  replyStyle: {
    hostile: {
      tone: string[];
      tactics: string[];
      patterns: Record<string, string[]>;
      banned: string[];
      lengthRange: [number, number];
    };
    neutral: {
      tone: string[];
      tactics: string[];
      lengthRange: [number, number];
    };
    friendly: {
      tone: string[];
      tactics: string[];
      lengthRange: [number, number];
    };
  };
  messageExamples: Array<{
    classification: string;
    input: string;
    reply: string;
  }>;
  settings: {
    replyOnly: boolean;
    autoPosting: boolean;
    focusOnHostile: boolean;
    effortAsymmetry: {
      maxWords: number;
      preferUnder: number;
      neverExplain: boolean;
    };
    botLoopPrevention: {
      enabled: boolean;
      maxDepth: number;
      cooldownMs: number;
    };
    voiceMatching: {
      enabled: boolean;
      adaptToEnergy: boolean;
      lowercaseAlways: boolean;
    };
  };
}

export function useCharacter() {
  return useQuery({
    queryKey: ['character'],
    queryFn: async () => {
      const res = await fetch('/api/character');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.character as CharacterConfig;
    },
  });
}

export function useUpdateCharacter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (character: Partial<CharacterConfig>) => {
      const res = await fetch('/api/character', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(character),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character'] });
    },
  });
}
