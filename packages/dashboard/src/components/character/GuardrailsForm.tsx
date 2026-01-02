import { Switch } from '@/components/ui/switch';
import type { CharacterConfig } from '@/hooks/useCharacter';
import { cn } from '@/lib/utils';

interface GuardrailsFormProps {
  character: Partial<CharacterConfig>;
  onUpdate: (updates: {
    maxWords?: number;
    focusOnHostile?: boolean;
    botLoopPrevention?: boolean;
    lowercaseAlways?: boolean;
    allowEmoji?: boolean;
  }) => void;
}

const WORD_RANGES = [
  { label: 'Ultra-brief', value: 8, description: '2-8 words' },
  { label: 'Balanced', value: 15, description: '5-15 words' },
  { label: 'Conversational', value: 25, description: '10-25 words' },
];

export function GuardrailsForm({ character, onUpdate }: GuardrailsFormProps) {
  const settings = character.settings;
  const currentMaxWords = settings?.effortAsymmetry?.maxWords || 15;
  const hasNoEmoji = character.style?.all?.includes('never use emoji');

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Set some ground rules</h2>
        <p className="text-sm text-zinc-400">Configure how your bot behaves.</p>
      </div>

      <div className="space-y-6">
        {/* Word Length */}
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">How wordy should replies be?</h4>
          <div className="space-y-2">
            {WORD_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => onUpdate({ maxWords: range.value })}
                className={cn(
                  'w-full flex items-center justify-between p-3 rounded-lg transition-all',
                  currentMaxWords === range.value
                    ? 'bg-orange-500/20 border border-orange-500'
                    : 'bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700'
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border-2',
                      currentMaxWords === range.value
                        ? 'border-orange-500 bg-orange-500'
                        : 'border-zinc-600'
                    )}
                  >
                    {currentMaxWords === range.value && (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                  <span className="text-sm text-zinc-200">{range.label}</span>
                </div>
                <span className="text-xs text-zinc-500">{range.description}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Reply Focus */}
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Reply focus</h4>
          <div className="space-y-3">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-200">Prioritize hostile comments</p>
                <p className="text-xs text-zinc-500">Focus on clap-backs over friendly replies</p>
              </div>
              <Switch
                checked={settings?.focusOnHostile ?? true}
                onCheckedChange={(checked) => onUpdate({ focusOnHostile: checked })}
              />
            </label>
          </div>
        </div>

        {/* Safety Nets */}
        <div className="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Safety nets</h4>
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-200">Prevent bot-to-bot loops</p>
                <p className="text-xs text-zinc-500">Stop replying to other bots to avoid infinite loops</p>
              </div>
              <Switch
                checked={settings?.botLoopPrevention?.enabled ?? true}
                onCheckedChange={(checked) => onUpdate({ botLoopPrevention: checked })}
              />
            </label>

            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-200">Always lowercase replies</p>
                <p className="text-xs text-zinc-500">lowercase gives dismissive energy</p>
              </div>
              <Switch
                checked={settings?.voiceMatching?.lowercaseAlways ?? true}
                onCheckedChange={(checked) => onUpdate({ lowercaseAlways: checked })}
              />
            </label>

            <label className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-200">Allow emojis</p>
                <p className="text-xs text-zinc-500">Include emojis in responses</p>
              </div>
              <Switch
                checked={!hasNoEmoji}
                onCheckedChange={(checked) => onUpdate({ allowEmoji: checked })}
              />
            </label>
          </div>
        </div>

        {/* Preview of settings */}
        <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
          <h4 className="text-sm font-medium text-zinc-200 mb-3">Configuration Summary</h4>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Max words:</span>
              <span className="text-zinc-300">{currentMaxWords}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Focus hostile:</span>
              <span className={settings?.focusOnHostile ? 'text-green-400' : 'text-zinc-500'}>
                {settings?.focusOnHostile ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Bot loop prevention:</span>
              <span className={settings?.botLoopPrevention?.enabled ? 'text-green-400' : 'text-zinc-500'}>
                {settings?.botLoopPrevention?.enabled ? 'On' : 'Off'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Lowercase:</span>
              <span className={settings?.voiceMatching?.lowercaseAlways ? 'text-green-400' : 'text-zinc-500'}>
                {settings?.voiceMatching?.lowercaseAlways ? 'Yes' : 'No'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Emojis:</span>
              <span className={!hasNoEmoji ? 'text-green-400' : 'text-zinc-500'}>
                {!hasNoEmoji ? 'Allowed' : 'Blocked'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
