'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, CalendarDays, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { markOnboardingSeen } from '@/lib/patient/onboarding-actions';

const SCREENS = [
  { title: 'Welcome to HEARTLAND', description: 'Use this workspace to practice check-ins and review your care plan with an authorized care team. Use fictional information during evaluation.', icon: Heart },
  { title: 'Your Daily Routine', description: 'Open Today to review your tasks, record a check-in and see messages from the care team.', icon: CalendarDays },
  { title: 'Privacy & access', description: 'Open Privacy & access to review the provider relationships recorded for this workspace. You can end an active link there.', icon: ShieldCheck },
] as const;

export function OnboardingOverlay({ showOnboarding }: { showOnboarding: boolean }) {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const screen = SCREENS[step];
  const Icon = screen.icon;
  useEffect(() => { if (step > 0) heading.current?.focus(); }, [step]);
  function finish() {
    setDismissed(true);
    void markOnboardingSeen().catch(() => undefined);
  }

  return (
    <Dialog open={showOnboarding && !dismissed} onOpenChange={(open) => { if (!open) setDismissed(true); }}>
      <DialogContent initialFocus={heading} finalFocus={() => document.querySelector<HTMLElement>('#main-content') ?? true} className="max-h-[90dvh] overflow-y-auto p-6 sm:p-8">
        <Icon className="size-10 text-blue-700" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-600">Introduction · {step + 1} of {SCREENS.length}</p>
        <DialogTitle ref={heading} tabIndex={-1} className="text-2xl">{screen.title}</DialogTitle>
        <DialogDescription className="text-base leading-6 text-slate-700">{screen.description}</DialogDescription>
        <div role="group" aria-label="Progress" className="flex gap-2">
          {SCREENS.map(({ title }, i) => <span key={title} aria-hidden="true" data-testid="progress-dot" className={`h-1.5 flex-1 rounded-full ${i === step ? 'bg-blue-600' : 'bg-gray-300'}`} />)}
        </div>
        <button type="button" onClick={step === SCREENS.length - 1 ? finish : () => setStep(step + 1)} className="min-h-12 rounded-lg bg-blue-700 px-4 text-base font-semibold text-white">
          {step === SCREENS.length - 1 ? 'Get Started' : 'Next'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
