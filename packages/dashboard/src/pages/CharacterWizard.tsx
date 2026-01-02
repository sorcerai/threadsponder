import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SpotlightCard } from '@/components/ui/spotlight-card';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { useCharacterWizard, WizardStep } from '@/hooks/useCharacterWizard';
import { ArchetypeSelector } from '@/components/character/ArchetypeSelector';
import { IdentityForm } from '@/components/character/IdentityForm';
import { ExampleTrainer } from '@/components/character/ExampleTrainer';
import { GuardrailsForm } from '@/components/character/GuardrailsForm';
import { LaunchPreview } from '@/components/character/LaunchPreview';
import { cn } from '@/lib/utils';

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Vibe',
  2: 'Identity',
  3: 'Examples',
  4: 'Guardrails',
  5: 'Launch',
};

const STEP_TIMES: Record<WizardStep, string> = {
  1: '30 sec',
  2: '60 sec',
  3: '90 sec',
  4: '30 sec',
  5: 'final',
};

export default function CharacterWizard() {
  const navigate = useNavigate();
  const wizard = useCharacterWizard();

  // Redirect on successful save
  useEffect(() => {
    if (!wizard.isSaving && !wizard.saveError && wizard.state.isDirty === false && wizard.state.step === 5) {
      // Only redirect if we just saved (isDirty changed from true to false)
    }
  }, [wizard.isSaving, wizard.saveError, wizard.state.isDirty, wizard.state.step]);

  const handleSave = async () => {
    await wizard.saveCharacter();
    navigate('/character');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white mb-1">
            Character Wizard
          </h1>
          <p className="text-muted-foreground text-sm">
            Configure your bot's personality in ~3 minutes
          </p>
        </div>

        <Button
          variant="ghost"
          onClick={() => navigate('/character')}
          className="gap-2 text-zinc-400"
        >
          <Settings className="w-4 h-4" />
          Advanced Editor
        </Button>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-2">
        {([1, 2, 3, 4, 5] as WizardStep[]).map((step) => {
          const isActive = wizard.state.step === step;
          const isCompleted = wizard.state.step > step;
          const isClickable = step <= wizard.state.step || (step === wizard.state.step + 1 && wizard.canProceed);

          return (
            <button
              key={step}
              onClick={() => isClickable && wizard.goToStep(step)}
              disabled={!isClickable}
              className={cn(
                'flex flex-col items-center transition-all',
                isClickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              )}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium mb-1',
                  isActive
                    ? 'bg-orange-500 text-white'
                    : isCompleted
                    ? 'bg-green-500 text-white'
                    : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {isCompleted ? '✓' : step}
              </div>
              <span
                className={cn(
                  'text-[10px]',
                  isActive ? 'text-orange-400' : 'text-zinc-500'
                )}
              >
                {STEP_LABELS[step]}
              </span>
              <span className="text-[9px] text-zinc-600">{STEP_TIMES[step]}</span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <SpotlightCard className="p-6 min-h-[500px]">
        {wizard.state.step === 1 && (
          <ArchetypeSelector
            selected={wizard.state.archetype}
            onSelect={wizard.selectArchetype}
          />
        )}

        {wizard.state.step === 2 && (
          <IdentityForm
            character={wizard.state.character}
            onUpdate={wizard.updateIdentity}
          />
        )}

        {wizard.state.step === 3 && (
          <ExampleTrainer
            userExamples={wizard.state.userExamples}
            onUpdate={wizard.updateExample}
          />
        )}

        {wizard.state.step === 4 && (
          <GuardrailsForm
            character={wizard.state.character}
            onUpdate={wizard.updateGuardrails}
          />
        )}

        {wizard.state.step === 5 && (
          <LaunchPreview
            character={wizard.state.character}
            archetype={wizard.state.archetype}
            completionScore={wizard.completionScore}
            userExamples={wizard.state.userExamples}
            onSave={handleSave}
            isSaving={wizard.isSaving}
            saveError={wizard.saveError}
            onEditDetails={() => wizard.goToStep(2)}
          />
        )}
      </SpotlightCard>

      {/* Navigation */}
      {wizard.state.step < 5 && (
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={wizard.prevStep}
            disabled={wizard.state.step === 1}
            className="gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">
              {wizard.completionScore}% complete
            </span>
            <Button
              onClick={wizard.nextStep}
              disabled={!wizard.canProceed}
              className="gap-1 bg-orange-600 hover:bg-orange-700"
            >
              {wizard.state.step === 4 ? 'Review' : 'Next'}
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
