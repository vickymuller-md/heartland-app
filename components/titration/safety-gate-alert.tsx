import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';
import type { SafetyGateResult } from '@/lib/titration/types';

interface SafetyGateAlertProps {
  results: SafetyGateResult[];
}

export function SafetyGateAlert({ results }: SafetyGateAlertProps) {
  return (
    <div className="space-y-3" data-testid="safety-gate-results">
      {results.map((result) => {
        if (result.status === 'blocked') {
          return (
            <Alert key={result.parameter} variant="destructive" role="alert">
              <XCircle className="size-4" />
              <AlertTitle>{result.parameter}: BLOCKED</AlertTitle>
              <AlertDescription>
                <p className="font-medium">{result.action}</p>
                <p className="mt-1 text-xs">{result.details}</p>
                <p className="mt-1 text-xs opacity-75">
                  Current value: {result.value} ({result.threshold})
                </p>
              </AlertDescription>
            </Alert>
          );
        }

        if (result.status === 'warning') {
          return (
            <Alert key={result.parameter}>
              <AlertTriangle className="size-4 text-yellow-600" />
              <AlertTitle>{result.parameter}: WARNING</AlertTitle>
              <AlertDescription>
                <p className="font-medium">{result.action}</p>
                <p className="mt-1 text-xs">{result.details}</p>
                <p className="mt-1 text-xs opacity-75">
                  Current value: {result.value} ({result.threshold})
                </p>
              </AlertDescription>
            </Alert>
          );
        }

        // Pass status - compact display
        return (
          <div
            key={result.parameter}
            className="flex items-center gap-2 text-sm text-emerald-700"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <span>{result.parameter}: Pass</span>
          </div>
        );
      })}
    </div>
  );
}
