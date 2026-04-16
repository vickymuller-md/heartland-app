import { Check } from 'lucide-react';
import type { TitrationStepDefinition } from '@/lib/titration/types';
import { cn } from '@/lib/utils';

interface StepperProps {
  steps: TitrationStepDefinition[];
  currentStep: number;
}

export function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <nav aria-label="Titration checklist progress" className="mb-6">
      <ol className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isFuture = index > currentStep;

          return (
            <li
              key={step.id}
              className="flex flex-1 items-center"
              aria-current={isCurrent ? 'step' : undefined}
            >
              <div className="flex flex-col items-center gap-1">
                {/* Circle */}
                <div
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                    isCompleted && 'border-emerald-600 bg-emerald-600 text-white',
                    isCurrent && 'border-primary bg-primary text-primary-foreground',
                    isFuture && 'border-muted-foreground/30 bg-muted text-muted-foreground'
                  )}
                >
                  {isCompleted ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                {/* Label */}
                <span
                  className={cn(
                    'text-center text-xs leading-tight',
                    isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                    isFuture && 'hidden md:block'
                  )}
                >
                  {step.label}
                </span>
              </div>
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'mx-1 mt-[-1rem] h-0.5 flex-1',
                    index < currentStep ? 'bg-emerald-600' : 'bg-muted-foreground/20'
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
