'use client';

import { useState, useCallback } from 'react';

interface UseStepperOptions {
  totalSteps: number;
  initialStep?: number;
}

export function useStepper({ totalSteps, initialStep = 0 }: UseStepperOptions) {
  const [currentStep, setCurrentStep] = useState(initialStep);

  const next = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
  }, [totalSteps]);

  const back = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const goTo = useCallback(
    (step: number) => {
      if (step >= 0 && step < totalSteps) {
        setCurrentStep(step);
      }
    },
    [totalSteps]
  );

  return {
    currentStep,
    next,
    back,
    goTo,
    isFirst: currentStep === 0,
    isLast: currentStep === totalSteps - 1,
    totalSteps,
  };
}
