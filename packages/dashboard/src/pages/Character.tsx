import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCharacter, useUpdateCharacter, CharacterConfig } from '@/hooks/useCharacter';
import {
  User,
  BookOpen,
  Scroll,
  Hash,
  Sparkles,
  Palette,
  MessageSquare,
  Settings,
  Plus,
  X,
  Save,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Wand2,
  HelpCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';

// Collapsible section component with optional tooltip
function Section({
  title,
  icon: Icon,
  children,
  defaultOpen = true,
  tooltip
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
  tooltip?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <SpotlightCard className="p-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
          {tooltip && (
            <Tooltip content={tooltip} side="right">
              <HelpCircle className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 cursor-help" />
            </Tooltip>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-500" />
        )}
      </button>
      {isOpen && <div className="mt-4">{children}</div>}
    </SpotlightCard>
  );
}

// Editable list component for arrays
function EditableList({
  items,
  onAdd,
  onRemove,
  onUpdate,
  placeholder = "Add new item..."
}: {
  items: string[];
  onAdd: (item: string) => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  placeholder?: string;
}) {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    if (newItem.trim()) {
      onAdd(newItem.trim());
      setNewItem('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          className="bg-zinc-900 border-zinc-800 flex-1"
        />
        <Button
          onClick={handleAdd}
          disabled={!newItem.trim()}
          size="sm"
          className="bg-orange-600 hover:bg-orange-700"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2 items-center group">
            <Input
              value={item}
              onChange={(e) => onUpdate(index, e.target.value)}
              className="bg-zinc-900/50 border-zinc-800 flex-1 text-sm"
            />
            <button
              onClick={() => onRemove(index)}
              className="p-1 text-red-400/50 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-zinc-500 italic">No items yet</p>
      )}
    </div>
  );
}

export default function Character() {
  const navigate = useNavigate();
  const { data: character, isLoading, refetch } = useCharacter();
  const updateCharacter = useUpdateCharacter();

  // Local state for editing
  const [localCharacter, setLocalCharacter] = useState<CharacterConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync local state when character loads
  useEffect(() => {
    if (character) {
      setLocalCharacter(character);
      setHasChanges(false);
    }
  }, [character]);

  // Helper to update local state
  const updateLocal = <K extends keyof CharacterConfig>(key: K, value: CharacterConfig[K]) => {
    if (!localCharacter) return;
    setLocalCharacter({ ...localCharacter, [key]: value });
    setHasChanges(true);
  };

  // Helper for nested updates
  const updateNestedLocal = <K extends keyof CharacterConfig>(
    _key: K,
    path: string[],
    value: unknown
  ) => {
    if (!localCharacter) return;

    const updated = { ...localCharacter };
    let current: Record<string, unknown> = updated as Record<string, unknown>;

    for (let i = 0; i < path.length - 1; i++) {
      current[path[i]] = { ...(current[path[i]] as Record<string, unknown>) };
      current = current[path[i]] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;

    setLocalCharacter(updated);
    setHasChanges(true);
  };

  // Array helpers
  const addToArray = (key: keyof CharacterConfig, item: string) => {
    if (!localCharacter) return;
    const arr = localCharacter[key] as string[];
    updateLocal(key, [...arr, item] as CharacterConfig[typeof key]);
  };

  const removeFromArray = (key: keyof CharacterConfig, index: number) => {
    if (!localCharacter) return;
    const arr = localCharacter[key] as string[];
    updateLocal(key, arr.filter((_, i) => i !== index) as CharacterConfig[typeof key]);
  };

  const updateInArray = (key: keyof CharacterConfig, index: number, value: string) => {
    if (!localCharacter) return;
    const arr = [...(localCharacter[key] as string[])];
    arr[index] = value;
    updateLocal(key, arr as CharacterConfig[typeof key]);
  };

  // Style array helpers
  const addToStyleArray = (styleKey: keyof CharacterConfig['style'], item: string) => {
    if (!localCharacter) return;
    const arr = localCharacter.style[styleKey];
    updateNestedLocal('style', [styleKey], [...arr, item]);
  };

  const removeFromStyleArray = (styleKey: keyof CharacterConfig['style'], index: number) => {
    if (!localCharacter) return;
    const arr = localCharacter.style[styleKey];
    updateNestedLocal('style', [styleKey], arr.filter((_, i) => i !== index));
  };

  const updateInStyleArray = (styleKey: keyof CharacterConfig['style'], index: number, value: string) => {
    if (!localCharacter) return;
    const arr = [...localCharacter.style[styleKey]];
    arr[index] = value;
    updateNestedLocal('style', [styleKey], arr);
  };

  // Save changes
  const handleSave = async () => {
    if (!localCharacter) return;
    await updateCharacter.mutateAsync(localCharacter);
    setHasChanges(false);
  };

  // Reset changes
  const handleReset = () => {
    if (character) {
      setLocalCharacter(character);
      setHasChanges(false);
    }
  };

  if (isLoading || !localCharacter) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Character</h1>
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-2">Character</h1>
          <p className="text-muted-foreground text-sm max-w-lg">
            Configure your agent's personality, style, and behavior.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => navigate('/wizard')}
            variant="ghost"
            size="sm"
            className="gap-1 text-orange-400"
          >
            <Wand2 className="w-4 h-4" />
            Run Wizard
          </Button>
          <Button
            onClick={() => refetch()}
            variant="ghost"
            size="sm"
            className="text-zinc-400"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          {hasChanges && (
            <>
              <Button
                onClick={handleReset}
                variant="ghost"
                size="sm"
                className="text-zinc-400"
              >
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateCharacter.isPending}
                size="sm"
                className="bg-orange-600 hover:bg-orange-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {updateCharacter.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Basic Info */}
      <Section title="Basic Info" icon={User} tooltip="Core identity: name, description, and model provider">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Name</label>
            <Input
              value={localCharacter.name}
              onChange={(e) => updateLocal('name', e.target.value)}
              className="bg-zinc-900 border-zinc-800"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <Textarea
              value={localCharacter.description}
              onChange={(e) => updateLocal('description', e.target.value)}
              className="bg-zinc-900 border-zinc-800 resize-none"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Model Provider</label>
              <Input
                value={localCharacter.modelProvider}
                onChange={(e) => updateLocal('modelProvider', e.target.value)}
                className="bg-zinc-900 border-zinc-800"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Clients</label>
              <Input
                value={localCharacter.clients.join(', ')}
                onChange={(e) => updateLocal('clients', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className="bg-zinc-900 border-zinc-800"
                placeholder="threads, discord, ..."
              />
            </div>
          </div>
        </div>
      </Section>

      {/* Bio & Lore */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Bio" icon={BookOpen} tooltip="Background info injected into prompts. Add multiple lines for variety.">
          <EditableList
            items={localCharacter.bio}
            onAdd={(item) => addToArray('bio', item)}
            onRemove={(index) => removeFromArray('bio', index)}
            onUpdate={(index, value) => updateInArray('bio', index, value)}
            placeholder="Add personality trait..."
          />
        </Section>

        <Section title="Lore" icon={Scroll} tooltip="Backstory and facts about the character. Used for context.">
          <EditableList
            items={localCharacter.lore}
            onAdd={(item) => addToArray('lore', item)}
            onRemove={(index) => removeFromArray('lore', index)}
            onUpdate={(index, value) => updateInArray('lore', index, value)}
            placeholder="Add backstory fact..."
          />
        </Section>
      </div>

      {/* Topics & Adjectives */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Topics" icon={Hash} tooltip="Subjects the bot knows about and can discuss.">
          <EditableList
            items={localCharacter.topics}
            onAdd={(item) => addToArray('topics', item)}
            onRemove={(index) => removeFromArray('topics', index)}
            onUpdate={(index, value) => updateInArray('topics', index, value)}
            placeholder="Add topic..."
          />
        </Section>

        <Section title="Adjectives" icon={Sparkles} tooltip="Personality traits that shape tone and voice.">
          <EditableList
            items={localCharacter.adjectives}
            onAdd={(item) => addToArray('adjectives', item)}
            onRemove={(index) => removeFromArray('adjectives', index)}
            onUpdate={(index, value) => updateInArray('adjectives', index, value)}
            placeholder="Add adjective..."
          />
        </Section>
      </div>

      {/* Style Rules */}
      <Section title="Style Rules" icon={Palette} tooltip="Writing style instructions. 'All' applies everywhere, others per context.">
        <div className="space-y-6">
          {(['all', 'hostile', 'friendly', 'neutral', 'meta'] as const).map((styleKey) => (
            <div key={styleKey}>
              <label className={cn(
                "text-xs mb-2 block font-medium capitalize",
                styleKey === 'hostile' && "text-red-400",
                styleKey === 'friendly' && "text-green-400",
                styleKey === 'neutral' && "text-blue-400",
                styleKey === 'meta' && "text-purple-400",
                styleKey === 'all' && "text-orange-400"
              )}>
                {styleKey} Style
              </label>
              <EditableList
                items={localCharacter.style[styleKey]}
                onAdd={(item) => addToStyleArray(styleKey, item)}
                onRemove={(index) => removeFromStyleArray(styleKey, index)}
                onUpdate={(index, value) => updateInStyleArray(styleKey, index, value)}
                placeholder={`Add ${styleKey} style rule...`}
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Reply Style */}
      <Section title="Reply Style" icon={MessageSquare} defaultOpen={false} tooltip="Length and tone settings per comment classification type.">
        <div className="space-y-6">
          {/* Hostile Reply Style */}
          <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-red-400 mb-3">Hostile Replies</h4>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Tone (comma separated)</label>
                <Input
                  value={localCharacter.replyStyle.hostile.tone.join(', ')}
                  onChange={(e) => updateNestedLocal('replyStyle', ['hostile', 'tone'],
                    e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  )}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Length Range (min, max words)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.hostile.lengthRange[0]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['hostile', 'lengthRange'],
                      [parseInt(e.target.value) || 0, localCharacter.replyStyle.hostile.lengthRange[1]]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                  <span className="text-zinc-500 self-center">to</span>
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.hostile.lengthRange[1]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['hostile', 'lengthRange'],
                      [localCharacter.replyStyle.hostile.lengthRange[0], parseInt(e.target.value) || 0]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Friendly Reply Style */}
          <div className="p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-green-400 mb-3">Friendly Replies</h4>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Tone (comma separated)</label>
                <Input
                  value={localCharacter.replyStyle.friendly.tone.join(', ')}
                  onChange={(e) => updateNestedLocal('replyStyle', ['friendly', 'tone'],
                    e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  )}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Length Range (min, max words)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.friendly.lengthRange[0]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['friendly', 'lengthRange'],
                      [parseInt(e.target.value) || 0, localCharacter.replyStyle.friendly.lengthRange[1]]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                  <span className="text-zinc-500 self-center">to</span>
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.friendly.lengthRange[1]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['friendly', 'lengthRange'],
                      [localCharacter.replyStyle.friendly.lengthRange[0], parseInt(e.target.value) || 0]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Neutral Reply Style */}
          <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-blue-400 mb-3">Neutral Replies</h4>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Tone (comma separated)</label>
                <Input
                  value={localCharacter.replyStyle.neutral.tone.join(', ')}
                  onChange={(e) => updateNestedLocal('replyStyle', ['neutral', 'tone'],
                    e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  )}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Length Range (min, max words)</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.neutral.lengthRange[0]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['neutral', 'lengthRange'],
                      [parseInt(e.target.value) || 0, localCharacter.replyStyle.neutral.lengthRange[1]]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                  <span className="text-zinc-500 self-center">to</span>
                  <Input
                    type="number"
                    value={localCharacter.replyStyle.neutral.lengthRange[1]}
                    onChange={(e) => updateNestedLocal('replyStyle', ['neutral', 'lengthRange'],
                      [localCharacter.replyStyle.neutral.lengthRange[0], parseInt(e.target.value) || 0]
                    )}
                    className="bg-zinc-900 border-zinc-800 w-20"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Message Examples */}
      <Section title="Message Examples" icon={MessageSquare} defaultOpen={false} tooltip="Sample input/reply pairs that teach the bot how to respond.">
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {localCharacter.messageExamples.map((example, index) => (
            <div key={index} className={cn(
              "p-3 rounded-lg border bg-black/20",
              example.classification === 'hostile' && "border-red-500/20",
              example.classification === 'friendly' && "border-green-500/20",
              example.classification === 'neutral' && "border-blue-500/20",
              example.classification === 'meta' && "border-purple-500/20"
            )}>
              <div className="flex items-center justify-between mb-2">
                <select
                  value={example.classification}
                  onChange={(e) => {
                    const updated = [...localCharacter.messageExamples];
                    updated[index] = { ...updated[index], classification: e.target.value };
                    updateLocal('messageExamples', updated);
                  }}
                  className={cn(
                    "text-xs px-2 py-1 rounded bg-black/20 border",
                    example.classification === 'hostile' && "border-red-500/30 text-red-400",
                    example.classification === 'friendly' && "border-green-500/30 text-green-400",
                    example.classification === 'neutral' && "border-blue-500/30 text-blue-400",
                    example.classification === 'meta' && "border-purple-500/30 text-purple-400"
                  )}
                >
                  <option value="hostile">hostile</option>
                  <option value="friendly">friendly</option>
                  <option value="neutral">neutral</option>
                  <option value="meta">meta</option>
                </select>
                <button
                  onClick={() => {
                    const updated = localCharacter.messageExamples.filter((_, i) => i !== index);
                    updateLocal('messageExamples', updated);
                  }}
                  className="text-red-400/50 hover:text-red-400 p-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase">Input</label>
                  <Textarea
                    value={example.input}
                    onChange={(e) => {
                      const updated = [...localCharacter.messageExamples];
                      updated[index] = { ...updated[index], input: e.target.value };
                      updateLocal('messageExamples', updated);
                    }}
                    className="bg-zinc-900/50 border-zinc-800 text-sm resize-none mt-1"
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 uppercase">Reply</label>
                  <Input
                    value={example.reply}
                    onChange={(e) => {
                      const updated = [...localCharacter.messageExamples];
                      updated[index] = { ...updated[index], reply: e.target.value };
                      updateLocal('messageExamples', updated);
                    }}
                    className="bg-zinc-900/50 border-zinc-800 text-sm mt-1"
                  />
                </div>
              </div>
            </div>
          ))}
          <Button
            onClick={() => {
              const updated = [
                ...localCharacter.messageExamples,
                { classification: 'hostile', input: '', reply: '' }
              ];
              updateLocal('messageExamples', updated);
            }}
            variant="ghost"
            className="w-full border border-dashed border-zinc-700 text-zinc-400 hover:text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Example
          </Button>
        </div>
      </Section>

      {/* Settings */}
      <Section title="Settings" icon={Settings} defaultOpen={false} tooltip="Behavior controls: reply limits, loop prevention, voice matching.">
        <div className="space-y-6">
          {/* Core Settings */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localCharacter.settings.replyOnly}
                onChange={(e) => updateNestedLocal('settings', ['settings', 'replyOnly'], e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-orange-500 focus:ring-orange-500"
              />
              <span className="text-sm text-zinc-300">Reply Only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localCharacter.settings.autoPosting}
                onChange={(e) => updateNestedLocal('settings', ['settings', 'autoPosting'], e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-orange-500 focus:ring-orange-500"
              />
              <span className="text-sm text-zinc-300">Auto Posting</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={localCharacter.settings.focusOnHostile}
                onChange={(e) => updateNestedLocal('settings', ['settings', 'focusOnHostile'], e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-orange-500 focus:ring-orange-500"
              />
              <span className="text-sm text-zinc-300">Focus on Hostile</span>
            </label>
          </div>

          {/* Effort Asymmetry */}
          <div className="p-4 bg-orange-500/5 border border-orange-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-orange-400 mb-3">Effort Asymmetry</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Max Words</label>
                <Input
                  type="number"
                  value={localCharacter.settings.effortAsymmetry.maxWords}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'effortAsymmetry', 'maxWords'], parseInt(e.target.value) || 0)}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Prefer Under</label>
                <Input
                  type="number"
                  value={localCharacter.settings.effortAsymmetry.preferUnder}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'effortAsymmetry', 'preferUnder'], parseInt(e.target.value) || 0)}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer self-end pb-2">
                <input
                  type="checkbox"
                  checked={localCharacter.settings.effortAsymmetry.neverExplain}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'effortAsymmetry', 'neverExplain'], e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-orange-500 focus:ring-orange-500"
                />
                <span className="text-sm text-zinc-300">Never Explain</span>
              </label>
            </div>
          </div>

          {/* Bot Loop Prevention */}
          <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-purple-400 mb-3">Bot Loop Prevention</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-2 cursor-pointer self-end pb-2">
                <input
                  type="checkbox"
                  checked={localCharacter.settings.botLoopPrevention.enabled}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'botLoopPrevention', 'enabled'], e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-purple-500 focus:ring-purple-500"
                />
                <span className="text-sm text-zinc-300">Enabled</span>
              </label>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Max Depth</label>
                <Input
                  type="number"
                  value={localCharacter.settings.botLoopPrevention.maxDepth}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'botLoopPrevention', 'maxDepth'], parseInt(e.target.value) || 0)}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Cooldown (ms)</label>
                <Input
                  type="number"
                  value={localCharacter.settings.botLoopPrevention.cooldownMs}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'botLoopPrevention', 'cooldownMs'], parseInt(e.target.value) || 0)}
                  className="bg-zinc-900 border-zinc-800"
                />
              </div>
            </div>
          </div>

          {/* Voice Matching */}
          <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
            <h4 className="text-sm font-medium text-blue-400 mb-3">Voice Matching</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localCharacter.settings.voiceMatching.enabled}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'voiceMatching', 'enabled'], e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-zinc-300">Enabled</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localCharacter.settings.voiceMatching.adaptToEnergy}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'voiceMatching', 'adaptToEnergy'], e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-zinc-300">Adapt to Energy</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localCharacter.settings.voiceMatching.lowercaseAlways}
                  onChange={(e) => updateNestedLocal('settings', ['settings', 'voiceMatching', 'lowercaseAlways'], e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-zinc-300">Lowercase Always</span>
              </label>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
