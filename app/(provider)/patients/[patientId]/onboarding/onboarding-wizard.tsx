'use client';

/**
 * OnboardingWizard -- 5-step patient setup wizard
 * Requirements: ONBD-02, ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * Renders a stepper UI with 5 onboarding steps. Progress is tracked via
 * a bitmask (setup_completed_steps column). Supports skip, mark complete,
 * and auto-resume at first incomplete step.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useStepper } from '@/hooks/use-stepper';
import { Stepper } from '@/components/titration/stepper';
import {
  SETUP_STEPS,
  ALL_STEPS_COMPLETE,
  isStepComplete,
} from '@/lib/onboarding/constants';
import { markSetupStep } from '@/lib/onboarding/actions';

interface OnboardingWizardProps {
  patientId: string;
  patientName: string;
  completedSteps: number;
}

/** Count the number of completed steps (popcount of relevant bits) */
function countCompleted(bitmask: number): number {
  return SETUP_STEPS.filter((s) => isStepComplete(bitmask, s.bit)).length;
}

/** Find the index of the first incomplete step, or 0 if all complete */
function findFirstIncomplete(bitmask: number): number {
  const idx = SETUP_STEPS.findIndex((s) => !isStepComplete(bitmask, s.bit));
  return idx === -1 ? 0 : idx;
}

export function OnboardingWizard({
  patientId,
  patientName,
  completedSteps: initialCompleted,
}: OnboardingWizardProps) {
  const [completedSteps, setCompletedSteps] = useState(initialCompleted);
  const [isPending, startTransition] = useTransition();

  const initialStep = findFirstIncomplete(initialCompleted);
  const { currentStep, next, back, goTo, isFirst, isLast } = useStepper({
    totalSteps: SETUP_STEPS.length,
    initialStep,
  });

  const completedCount = countCompleted(completedSteps);
  const isAllComplete = completedSteps === ALL_STEPS_COMPLETE;
  const step = SETUP_STEPS[currentStep];

  // Resolve href with patientId substitution
  const resolvedHref = step.href
    ? step.href.replace('[patientId]', patientId)
    : null;

  // Map OnboardingStep to TitrationStepDefinition for Stepper component
  const stepperSteps = SETUP_STEPS.map((s) => ({
    id: String(s.id),
    label: s.label,
    description: s.description,
  }));

  function handleMarkComplete() {
    // Optimistic update
    const newSteps = completedSteps | step.bit;
    setCompletedSteps(newSteps);
    next();

    startTransition(async () => {
      const result = await markSetupStep(patientId, step.bit);
      if (result.error) {
        toast.error(result.error);
        // Revert optimistic update
        setCompletedSteps(completedSteps);
      }
    });
  }

  function handleSkip() {
    goTo(currentStep + 1);
  }

  return (
    <div className="space-y-6">
      {/* Progress indicator */}
      <p className="text-sm text-muted-foreground">
        {isAllComplete
          ? 'Setup complete!'
          : `Setup ${completedCount}/5 complete`}
      </p>

      {/* Desktop stepper (md+) */}
      <div className="hidden md:block">
        <Stepper steps={stepperSteps} currentStep={currentStep} />
      </div>

      {/* Mobile stepper (< md) */}
      <p className="text-sm font-medium text-muted-foreground md:hidden">
        Step {currentStep + 1} of 5 — {step.label}
      </p>

      {/* Complete banner */}
      {isAllComplete ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-lg font-semibold text-green-800">
            Setup complete!
          </p>
          <p className="mt-1 text-sm text-green-700">
            This patient is fully configured.
          </p>
        </div>
      ) : (
        /* Step card */
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">{step.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {step.description}
          </p>

          {/* Step-specific content */}
          <div className="mt-4">
            {step.href === null ? (
              /* Device Setup Guide -- inline content */
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Guide the patient on setting up their monitoring equipment:
                </p>
                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  <li>
                    Digital scale (weigh daily in the morning)
                  </li>
                  <li>
                    Blood pressure cuff (sit quietly 5 min before measuring)
                  </li>
                  <li>
                    Smartphone app (show /today page, explain daily logging)
                  </li>
                </ul>
              </div>
            ) : (
              /* Tool link */
              <Link
                href={resolvedHref!}
                className="inline-flex items-center text-sm font-medium text-primary hover:underline"
              >
                Go to Tool
              </Link>
            )}
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex items-center gap-3">
            {!isFirst && (
              <button
                type="button"
                onClick={back}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Mark Complete
            </button>
            {!isLast && (
              <button
                type="button"
                onClick={handleSkip}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Skip
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
