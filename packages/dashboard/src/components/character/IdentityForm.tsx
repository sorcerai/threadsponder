import { useState, KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { CharacterConfig } from '@/hooks/useCharacter';

interface IdentityFormProps {
  character: Partial<CharacterConfig>;
  onUpdate: (updates: {
    name?: string;
    description?: string;
    adjectives?: string[];
  }) => void;
}

export function IdentityForm({ character, onUpdate }: IdentityFormProps) {
  const [newAdjective, setNewAdjective] = useState('');

  const handleAddAdjective = () => {
    const adj = newAdjective.trim().toLowerCase();
    if (adj && !character.adjectives?.includes(adj)) {
      onUpdate({
        adjectives: [...(character.adjectives || []), adj],
      });
      setNewAdjective('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddAdjective();
    }
  };

  const handleRemoveAdjective = (adj: string) => {
    onUpdate({
      adjectives: character.adjectives?.filter((a) => a !== adj),
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Define your bot's identity</h2>
        <p className="text-sm text-zinc-400">Give it a name and personality traits.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Form */}
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-zinc-200 mb-1.5">
              Bot Name <span className="text-red-400">*</span>
            </label>
            <Input
              value={character.name || ''}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="threadfire-agent"
              className="bg-zinc-900 border-zinc-800"
            />
            <p className="text-xs text-zinc-500 mt-1">
              This appears in logs and debugging. Keep it simple.
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-zinc-200 mb-1.5">
              What's their deal?
            </label>
            <Textarea
              value={character.description || ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Dismissive tech creator who doesn't engage with bad faith arguments..."
              rows={3}
              className="bg-zinc-900 border-zinc-800 resize-none"
            />
            <p className="text-xs text-zinc-500 mt-1">
              One sentence that captures your bot's vibe.
            </p>
          </div>

          {/* Adjectives */}
          <div>
            <label className="block text-sm font-medium text-zinc-200 mb-1.5">
              3 words that describe them
            </label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newAdjective}
                onChange={(e) => setNewAdjective(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="unbothered"
                className="bg-zinc-900 border-zinc-800 flex-1"
              />
              <Button
                type="button"
                onClick={handleAddAdjective}
                disabled={!newAdjective.trim()}
                className="bg-zinc-800 hover:bg-zinc-700"
              >
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {character.adjectives?.map((adj) => (
                <span
                  key={adj}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/20 text-orange-400 text-xs"
                >
                  {adj}
                  <button
                    type="button"
                    onClick={() => handleRemoveAdjective(adj)}
                    className="hover:text-orange-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {(!character.adjectives || character.adjectives.length === 0) && (
                <span className="text-xs text-zinc-500">Add at least 3 adjectives</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Live Preview</h4>

          <div className="space-y-4">
            {/* Identity Card */}
            <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <span className="text-orange-400 text-sm">
                    {(character.name || 'B')[0].toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {character.name || 'your-bot-name'}
                  </p>
                  <p className="text-[10px] text-zinc-500">@threads</p>
                </div>
              </div>

              {character.description && (
                <p className="text-xs text-zinc-400 italic">"{character.description}"</p>
              )}
            </div>

            {/* Personality Tags */}
            {character.adjectives && character.adjectives.length > 0 && (
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
                  Personality
                </p>
                <div className="flex flex-wrap gap-1">
                  {character.adjectives.map((adj) => (
                    <span
                      key={adj}
                      className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-xs"
                    >
                      {adj}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sample Reply */}
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
                Sample Reply
              </p>
              <div className="p-2 rounded bg-zinc-800 border border-zinc-700">
                <p className="text-xs text-zinc-400">
                  <span className="text-red-400">@hater:</span> "you're trash"
                </p>
                <p className="text-xs text-zinc-200 mt-1">
                  → {character.adjectives?.includes('dismissive') ? '"sounds personal"' :
                     character.adjectives?.includes('enthusiastic') ? '"thanks for stopping by!"' :
                     character.adjectives?.includes('calm') ? '"appreciate the feedback"' :
                     '"response based on your personality"'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
