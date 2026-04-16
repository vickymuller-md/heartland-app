'use client';

import { useMemo } from 'react';
import { SafetyGateAlert } from '@/components/titration/safety-gate-alert';
import { evaluateSafetyGates, canProceedPastSafetyGates } from '@/lib/titration/engine';
import type { VitalSigns } from '@/lib/titration/types';
import { CheckCircle2, XCircle } from 'lucide-react';

interface SafetyGateCheckProps {
  vitals: VitalSigns;
}

export function SafetyGateCheck({ vitals }: SafetyGateCheckProps) {
  const results = useMemo(() => evaluateSafetyGates(vitals), [vitals]);
  const canProceed = useMemo(() => canProceedPastSafetyGates(results), [results]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Safety Gate Check</h2>
      <p className="text-sm text-muted-foreground">
        Automated evaluation of vital sign thresholds. All gates must pass (no blocks) to proceed to
        titration decision.
      </p>

      <SafetyGateAlert results={results} />

      {/* Summary */}
      <div
        className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${
          canProceed
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200'
            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200'
        }`}
        data-testid="safety-gate-summary"
      >
        {canProceed ? (
          <>
            <CheckCircle2 className="size-5" />
            All safety gates passed -- safe to proceed to titration decision.
          </>
        ) : (
          <>
            <XCircle className="size-5" />
            One or more safety gates blocked -- cannot proceed to titration decision.
          </>
        )}
      </div>
    </div>
  );
}
