import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, ChevronRight, SkipForward, MessageCircle } from 'lucide-react';
import { TRAINING_SCENARIOS } from '@/lib/archetypes';
import { cn } from '@/lib/utils';

interface ExampleTrainerProps {
  userExamples: Record<string, string>;
  onUpdate: (scenarioId: string, reply: string) => void;
}

export function ExampleTrainer({ userExamples, onUpdate }: ExampleTrainerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scenario = TRAINING_SCENARIOS[currentIndex];

  const handleNext = () => {
    if (currentIndex < TRAINING_SCENARIOS.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const completedCount = Object.keys(userExamples).filter(
    (k) => userExamples[k]?.trim()
  ).length;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white mb-2">Teach through examples</h2>
        <p className="text-sm text-zinc-400">
          Show your bot how to respond. Pre-filled from your archetype - edit or accept.
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-center gap-2">
        {TRAINING_SCENARIOS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setCurrentIndex(i)}
            className={cn(
              'w-3 h-3 rounded-full transition-all',
              i === currentIndex
                ? 'bg-orange-500 scale-125'
                : userExamples[s.id]?.trim()
                  ? 'bg-green-500'
                  : 'bg-zinc-700'
            )}
            title={s.label}
          />
        ))}
      </div>

      {/* Scenario Card */}
      <div className="p-6 rounded-xl bg-zinc-800/50 border border-zinc-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium',
                scenario.type === 'hostile' || scenario.type === 'rant'
                  ? 'bg-red-500/20 text-red-400'
                  : scenario.type === 'friendly'
                    ? 'bg-green-500/20 text-green-400'
                    : scenario.type === 'meta'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-blue-500/20 text-blue-400'
              )}
            >
              {scenario.label}
            </span>
            <span className="text-xs text-zinc-500">
              {currentIndex + 1} of {TRAINING_SCENARIOS.length}
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {completedCount}/{TRAINING_SCENARIOS.length} completed
          </span>
        </div>

        {/* The hostile comment */}
        <div className="p-4 rounded-lg bg-zinc-900/80 border border-zinc-800 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-4 h-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">@someone says:</p>
              <p className="text-sm text-zinc-200">{scenario.prompt}</p>
            </div>
          </div>
        </div>

        {/* Reply input */}
        <div>
          <label className="block text-sm font-medium text-zinc-200 mb-1.5">
            Your bot replies:
          </label>
          <Textarea
            value={userExamples[scenario.id] || ''}
            onChange={(e) => onUpdate(scenario.id, e.target.value)}
            placeholder="Type your response..."
            rows={2}
            className="bg-zinc-900 border-zinc-800 resize-none"
          />
          <p className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
            <span className="text-yellow-500">💡</span> {scenario.tip}
          </p>
        </div>

        {/* Word count */}
        {userExamples[scenario.id] && (
          <div className="mt-2 text-xs text-zinc-500">
            {userExamples[scenario.id].split(/\s+/).filter(Boolean).length} words
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </Button>

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={handleNext}
            disabled={currentIndex === TRAINING_SCENARIOS.length - 1}
            className="gap-1 text-zinc-400"
          >
            <SkipForward className="w-4 h-4" />
            Skip
          </Button>
          <Button
            onClick={handleNext}
            disabled={currentIndex === TRAINING_SCENARIOS.length - 1}
            className="gap-1 bg-orange-600 hover:bg-orange-700"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* All Examples Summary */}
      <div className="p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
        <h4 className="text-sm font-medium text-zinc-200 mb-3">All Examples</h4>
        <div className="space-y-2">
          {TRAINING_SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrentIndex(i)}
              className={cn(
                'w-full flex items-center justify-between p-2 rounded text-left transition-colors',
                i === currentIndex ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    userExamples[s.id]?.trim() ? 'bg-green-500' : 'bg-zinc-700'
                  )}
                />
                <span className="text-xs text-zinc-400">{s.label}</span>
              </div>
              {userExamples[s.id]?.trim() && (
                <span className="text-xs text-zinc-500 truncate max-w-[200px]">
                  "{userExamples[s.id]}"
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
