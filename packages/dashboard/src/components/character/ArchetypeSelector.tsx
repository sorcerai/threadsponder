import { ArchetypeKey, ARCHETYPE_META } from '@/lib/archetypes';
import { cn } from '@/lib/utils';

interface ArchetypeSelectorProps {
  selected: ArchetypeKey | null;
  onSelect: (archetype: ArchetypeKey) => void;
}

const archetypeOrder: ArchetypeKey[] = ['savage', 'hype', 'chill', 'chaotic', 'graceful', 'custom'];

export function ArchetypeSelector({ selected, onSelect }: ArchetypeSelectorProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">What energy does your bot bring?</h2>
        <p className="text-sm text-zinc-400">Pick a vibe. You can customize everything later.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {archetypeOrder.map((key) => {
          const meta = ARCHETYPE_META[key];
          const isSelected = selected === key;
          const isCustom = key === 'custom';

          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className={cn(
                'p-4 rounded-xl border-2 transition-all text-left',
                'hover:border-orange-500/50 hover:bg-zinc-800/50',
                isSelected
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-zinc-800 bg-zinc-900/50',
                isCustom && 'border-dashed'
              )}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-white text-sm">{meta.name}</h3>
                  <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{meta.tagline}</p>
                  {meta.preview && (
                    <p className="text-xs text-orange-400 mt-2 font-mono truncate">
                      {meta.preview}
                    </p>
                  )}
                </div>
              </div>

              {!isCustom && (
                <div className="mt-3 flex gap-2 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                    Hostile: {meta.hostileTone}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                    Friendly: {meta.friendlyTone}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected && selected !== 'custom' && (
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-2">
            {ARCHETYPE_META[selected].name} Preview
          </h4>
          <div className="space-y-2 text-xs text-zinc-400">
            <p>
              <span className="text-red-400">Hostile:</span>{' '}
              {ARCHETYPE_META[selected].hostileTone}
            </p>
            <p>
              <span className="text-green-400">Friendly:</span>{' '}
              {ARCHETYPE_META[selected].friendlyTone}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
