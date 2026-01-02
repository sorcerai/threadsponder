import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, Rocket, CheckCircle, AlertCircle } from 'lucide-react';
import type { CharacterConfig } from '@/hooks/useCharacter';
import { ARCHETYPE_META, ArchetypeKey } from '@/lib/archetypes';
import { cn } from '@/lib/utils';

interface LaunchPreviewProps {
  character: Partial<CharacterConfig>;
  archetype: ArchetypeKey | null;
  completionScore: number;
  userExamples: Record<string, string>;
  onSave: () => Promise<void>;
  isSaving: boolean;
  saveError: Error | null;
  onEditDetails: () => void;
}

export function LaunchPreview({
  character,
  archetype,
  completionScore,
  userExamples,
  onSave,
  isSaving,
  saveError,
  onEditDetails,
}: LaunchPreviewProps) {
  const [testInput, setTestInput] = useState('');
  const [testReply, setTestReply] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const handleTestDrive = async () => {
    if (!testInput.trim()) return;

    setIsTesting(true);
    setTestError(null);

    try {
      const response = await fetch('/api/character/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character,
          testInput: testInput.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error('Preview failed');
      }

      const data = await response.json();
      setTestReply(data.reply);
    } catch {
      setTestError('Could not generate preview. Try again.');
    } finally {
      setIsTesting(false);
    }
  };

  const exampleCount = Object.keys(userExamples).filter((k) => userExamples[k]?.trim()).length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Ready to launch?</h2>
        <p className="text-sm text-zinc-400">Review your configuration and test drive your bot.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Summary */}
        <div className="space-y-4">
          {/* Character Card */}
          <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                <span className="text-orange-400 text-xl">
                  {(character.name || 'B')[0].toUpperCase()}
                </span>
              </div>
              <div>
                <h3 className="font-medium text-white">{character.name || 'your-bot-name'}</h3>
                <p className="text-xs text-zinc-400">{character.description}</p>
              </div>
            </div>

            {archetype && archetype !== 'custom' && (
              <div className="mb-3">
                <span className="text-xs text-zinc-500">Archetype:</span>
                <span className="ml-2 text-xs text-orange-400">
                  {ARCHETYPE_META[archetype].emoji} {ARCHETYPE_META[archetype].name}
                </span>
              </div>
            )}

            {/* Completion Score */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-500">Completion</span>
                <span className={completionScore >= 80 ? 'text-green-400' : 'text-orange-400'}>
                  {completionScore}%
                </span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    completionScore >= 80 ? 'bg-green-500' : 'bg-orange-500'
                  )}
                  style={{ width: `${completionScore}%` }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2 rounded bg-zinc-900/50">
                <span className="text-zinc-500">Personality</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {character.adjectives?.slice(0, 3).map((adj) => (
                    <span key={adj} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      {adj}
                    </span>
                  ))}
                </div>
              </div>
              <div className="p-2 rounded bg-zinc-900/50">
                <span className="text-zinc-500">Examples</span>
                <p className="text-zinc-300 mt-1">{exampleCount} trained</p>
              </div>
              <div className="p-2 rounded bg-zinc-900/50">
                <span className="text-zinc-500">Reply Length</span>
                <p className="text-zinc-300 mt-1">
                  {character.settings?.effortAsymmetry?.maxWords || 15} words max
                </p>
              </div>
              <div className="p-2 rounded bg-zinc-900/50">
                <span className="text-zinc-500">Focus</span>
                <p className="text-zinc-300 mt-1">
                  {character.settings?.focusOnHostile ? 'Hostile' : 'All'} comments
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              onClick={onEditDetails}
              className="w-full mt-3 text-zinc-400"
            >
              Edit Details
            </Button>
          </div>

          {/* Checklist */}
          <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <h4 className="text-sm font-medium text-zinc-200 mb-3">Pre-flight Checklist</h4>
            <div className="space-y-2">
              <ChecklistItem
                label="Name configured"
                checked={!!character.name}
              />
              <ChecklistItem
                label="Personality defined"
                checked={(character.adjectives?.length || 0) >= 3}
              />
              <ChecklistItem
                label="Examples trained"
                checked={exampleCount >= 3}
              />
              <ChecklistItem
                label="Guardrails set"
                checked={!!character.settings}
              />
            </div>
          </div>
        </div>

        {/* Right: Test Drive */}
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Test Drive</h4>

          <div className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Write any comment:</label>
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Type a hostile, friendly, or neutral comment to test..."
                rows={3}
                className="bg-zinc-900 border-zinc-800 resize-none"
              />
            </div>

            <Button
              onClick={handleTestDrive}
              disabled={isTesting || !testInput.trim()}
              className="w-full bg-zinc-700 hover:bg-zinc-600"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Generate Reply
                </>
              )}
            </Button>

            {testReply && (
              <div className="p-3 rounded bg-zinc-900/80 border border-zinc-700">
                <p className="text-xs text-zinc-500 mb-1">Bot replies:</p>
                <p className="text-sm text-zinc-200">{testReply}</p>
              </div>
            )}

            {testError && (
              <div className="p-3 rounded bg-red-500/10 border border-red-500/30">
                <p className="text-xs text-red-400">{testError}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Launch Button */}
      <div className="flex flex-col items-center gap-3 pt-4">
        {saveError && (
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            {saveError.message}
          </div>
        )}

        <Button
          onClick={onSave}
          disabled={isSaving || completionScore < 50}
          className="px-8 py-6 text-lg bg-orange-600 hover:bg-orange-700"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Launching...
            </>
          ) : (
            <>
              <Rocket className="w-5 h-5 mr-2" />
              Launch Bot
            </>
          )}
        </Button>

        {completionScore < 50 && (
          <p className="text-xs text-zinc-500">
            Complete at least 50% of the configuration to launch
          </p>
        )}
      </div>
    </div>
  );
}

function ChecklistItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'w-4 h-4 rounded-full flex items-center justify-center',
          checked ? 'bg-green-500/20' : 'bg-zinc-800'
        )}
      >
        {checked && <CheckCircle className="w-3 h-3 text-green-400" />}
      </div>
      <span className={cn('text-xs', checked ? 'text-zinc-300' : 'text-zinc-500')}>{label}</span>
    </div>
  );
}
