import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CharacterConfig } from '@/hooks/useCharacter';
import {
  ArchetypeKey,
  ARCHETYPES,
  applyArchetype,
  getEmptyCharacter,
  getArchetypeExamples,
  TRAINING_SCENARIOS,
} from '@/lib/archetypes';

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export interface WizardState {
  step: WizardStep;
  archetype: ArchetypeKey | null;
  character: Partial<CharacterConfig>;
  userExamples: Record<string, string>; // scenarioId -> reply
  isDirty: boolean;
}

interface UseCharacterWizardReturn {
  // State
  state: WizardState;
  isValid: boolean;
  canProceed: boolean;
  completionScore: number;

  // Navigation
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: WizardStep) => void;

  // Step 1: Archetype
  selectArchetype: (archetype: ArchetypeKey) => void;

  // Step 2: Identity
  updateIdentity: (updates: {
    name?: string;
    description?: string;
    adjectives?: string[];
  }) => void;

  // Step 3: Examples
  updateExample: (scenarioId: string, reply: string) => void;
  getExampleForScenario: (scenarioId: string) => string;

  // Step 4: Guardrails
  updateGuardrails: (updates: {
    maxWords?: number;
    focusOnHostile?: boolean;
    botLoopPrevention?: boolean;
    lowercaseAlways?: boolean;
    allowEmoji?: boolean;
  }) => void;

  // Step 5: Save
  saveCharacter: () => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;

  // Utils
  reset: () => void;
}

const initialState: WizardState = {
  step: 1,
  archetype: null,
  character: getEmptyCharacter(),
  userExamples: {},
  isDirty: false,
};

export function useCharacterWizard(): UseCharacterWizardReturn {
  const [state, setState] = useState<WizardState>(initialState);
  const queryClient = useQueryClient();

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (character: Partial<CharacterConfig>) => {
      const response = await fetch('/api/character', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(character),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save character');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['character'] });
      setState((prev) => ({ ...prev, isDirty: false }));
    },
  });

  // Calculate completion score
  const completionScore = useMemo(() => {
    const { character } = state;
    let score = 0;
    let total = 0;

    // Name (required)
    total += 20;
    if (character.name) score += 20;

    // Description
    total += 10;
    if (character.description) score += 10;

    // Adjectives (at least 3)
    total += 15;
    if (character.adjectives && character.adjectives.length >= 3) score += 15;
    else if (character.adjectives && character.adjectives.length > 0) score += 5;

    // Bio
    total += 15;
    if (character.bio && character.bio.length >= 5) score += 15;
    else if (character.bio && character.bio.length > 0) score += 5;

    // Examples (at least 3)
    total += 20;
    const exampleCount = Object.keys(state.userExamples).filter(
      (k) => state.userExamples[k]?.trim()
    ).length;
    if (exampleCount >= 3) score += 20;
    else if (exampleCount > 0) score += 7 * Math.min(exampleCount, 3);

    // Settings configured
    total += 20;
    if (character.settings) score += 20;

    return Math.round((score / total) * 100);
  }, [state.character, state.userExamples]);

  // Validation per step
  const isValid = useMemo(() => {
    switch (state.step) {
      case 1:
        return state.archetype !== null;
      case 2:
        return !!state.character.name?.trim();
      case 3:
        return true; // Examples are optional
      case 4:
        return true; // Guardrails have defaults
      case 5:
        return completionScore >= 50;
      default:
        return false;
    }
  }, [state.step, state.archetype, state.character.name, completionScore]);

  const canProceed = isValid;

  // Navigation
  const nextStep = useCallback(() => {
    if (state.step < 5 && canProceed) {
      setState((prev) => ({ ...prev, step: (prev.step + 1) as WizardStep }));
    }
  }, [state.step, canProceed]);

  const prevStep = useCallback(() => {
    if (state.step > 1) {
      setState((prev) => ({ ...prev, step: (prev.step - 1) as WizardStep }));
    }
  }, [state.step]);

  const goToStep = useCallback((step: WizardStep) => {
    setState((prev) => ({ ...prev, step }));
  }, []);

  // Step 1: Archetype selection
  const selectArchetype = useCallback((archetype: ArchetypeKey) => {
    const character = applyArchetype(archetype);
    const userExamples = getArchetypeExamples(archetype);

    setState((prev) => ({
      ...prev,
      archetype,
      character: {
        ...character,
        // Keep user's name if already set
        name: prev.character.name || character.name || '',
      },
      userExamples,
      isDirty: true,
    }));
  }, []);

  // Step 2: Identity updates
  const updateIdentity = useCallback(
    (updates: { name?: string; description?: string; adjectives?: string[] }) => {
      setState((prev) => ({
        ...prev,
        character: {
          ...prev.character,
          ...updates,
        },
        isDirty: true,
      }));
    },
    []
  );

  // Step 3: Example updates
  const updateExample = useCallback((scenarioId: string, reply: string) => {
    setState((prev) => ({
      ...prev,
      userExamples: {
        ...prev.userExamples,
        [scenarioId]: reply,
      },
      isDirty: true,
    }));
  }, []);

  const getExampleForScenario = useCallback(
    (scenarioId: string): string => {
      return state.userExamples[scenarioId] || '';
    },
    [state.userExamples]
  );

  // Step 4: Guardrails updates
  const updateGuardrails = useCallback(
    (updates: {
      maxWords?: number;
      focusOnHostile?: boolean;
      botLoopPrevention?: boolean;
      lowercaseAlways?: boolean;
      allowEmoji?: boolean;
    }) => {
      setState((prev) => {
        const settings = prev.character.settings || {
          replyOnly: true,
          autoPosting: false,
          focusOnHostile: true,
          effortAsymmetry: { maxWords: 15, preferUnder: 8, neverExplain: true },
          botLoopPrevention: { enabled: true, maxDepth: 2, cooldownMs: 300000 },
          voiceMatching: { enabled: true, adaptToEnergy: true, lowercaseAlways: true },
        };

        const style = {
          all: [],
          hostile: [],
          friendly: [],
          neutral: [],
          meta: [],
          ...prev.character.style
        };

        // Update settings based on guardrails
        if (updates.maxWords !== undefined) {
          settings.effortAsymmetry = {
            ...settings.effortAsymmetry,
            maxWords: updates.maxWords,
            preferUnder: Math.floor(updates.maxWords * 0.6),
          };
        }

        if (updates.focusOnHostile !== undefined) {
          settings.focusOnHostile = updates.focusOnHostile;
        }

        if (updates.botLoopPrevention !== undefined) {
          settings.botLoopPrevention = {
            ...settings.botLoopPrevention,
            enabled: updates.botLoopPrevention,
          };
        }

        if (updates.lowercaseAlways !== undefined) {
          settings.voiceMatching = {
            ...settings.voiceMatching,
            lowercaseAlways: updates.lowercaseAlways,
          };

          // Update style rules
          const currentAll = style.all || [];
          if (updates.lowercaseAlways) {
            if (!currentAll.includes('always lowercase')) {
              style.all = [...currentAll, 'always lowercase'];
            } else {
              style.all = currentAll;
            }
          } else {
            style.all = currentAll.filter((s) => s !== 'always lowercase');
          }
        }

        if (updates.allowEmoji !== undefined) {
          const currentAll = style.all || [];
          if (!updates.allowEmoji) {
            if (!currentAll.includes('never use emoji')) {
              style.all = [...currentAll, 'never use emoji'];
            } else {
              style.all = currentAll;
            }
          } else {
            style.all = currentAll.filter((s) => s !== 'never use emoji');
          }
        }

        return {
          ...prev,
          character: {
            ...prev.character,
            settings,
            style,
          },
          isDirty: true,
        };
      });
    },
    []
  );

  // Build final character with user examples
  const buildFinalCharacter = useCallback((): Partial<CharacterConfig> => {
    const { character, userExamples } = state;

    // Convert user examples to messageExamples format
    const messageExamples: CharacterConfig['messageExamples'] = [];
    for (const scenario of TRAINING_SCENARIOS) {
      const reply = userExamples[scenario.id]?.trim();
      if (reply) {
        messageExamples.push({
          classification: scenario.type === 'rant' ? 'hostile' : scenario.type,
          input: scenario.prompt,
          reply,
        });
      }
    }

    // Merge with archetype examples
    const archetypeExamples = state.archetype && state.archetype !== 'custom'
      ? ARCHETYPES[state.archetype].messageExamples || []
      : [];

    return {
      ...character,
      messageExamples: [...messageExamples, ...archetypeExamples],
      modelProvider: character.modelProvider || 'gemini',
      clients: character.clients || ['threads'],
    };
  }, [state]);

  // Step 5: Save
  const saveCharacter = useCallback(async () => {
    const finalCharacter = buildFinalCharacter();
    await saveMutation.mutateAsync(finalCharacter);
  }, [buildFinalCharacter, saveMutation]);

  // Reset wizard
  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    isValid,
    canProceed,
    completionScore,
    nextStep,
    prevStep,
    goToStep,
    selectArchetype,
    updateIdentity,
    updateExample,
    getExampleForScenario,
    updateGuardrails,
    saveCharacter,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
    reset,
  };
}
