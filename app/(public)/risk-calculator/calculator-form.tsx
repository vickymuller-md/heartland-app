'use client';

import { useMemo, useState, useEffect, useActionState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RotateCcw, Printer } from 'lucide-react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { riskInputSchema, type RiskInputFormInput } from '@/lib/risk-score/schema';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import { RISK_VARIABLES } from '@/lib/risk-score/constants';
import type { RiskInput } from '@/lib/risk-score/types';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { saveRiskScore } from '@/lib/integration/actions';

import { ResultCard } from './result-card';
import { ScoreBreakdown } from './score-breakdown';
import { PrintHeader } from './print-header';

/** Group variables by category for fieldset rendering */
const CATEGORIES = [
  'Clinical',
  'Laboratory',
  'Cardiac',
  'Comorbidity',
  'Social/Geographic',
] as const;

function groupByCategory() {
  return CATEGORIES.map((cat) => ({
    category: cat,
    variables: RISK_VARIABLES.filter((v) => v.category === cat),
  }));
}

/**
 * Client-side calculator form with 10 binary toggle inputs.
 * Score updates instantly via useWatch + useMemo (MDCalc pattern).
 */
export function CalculatorForm({ clinicalIntegrationEnabled = false }: { clinicalIntegrationEnabled?: boolean }) {
  const { control, reset } = useForm<RiskInputFormInput>({
    resolver: zodResolver(riskInputSchema),
    defaultValues: {
      ageOver75: false,
      priorHfHospitalization: false,
      egfrBelow45: false,
      elevatedNatriuretic: false,
      sbpBelow100: false,
      diabetes: false,
      lvefBelow30: false,
      ckmStage3or4: false,
      distanceOver50Miles: false,
      livesAloneOrLimitedSupport: false,
    },
  });

  const watchedValues = useWatch({ control });

  // Patient integration state
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [saveState, saveAction, isSaving] = useActionState(saveRiskScore, null);

  // Toast on save result
  useEffect(() => {
    if (!saveState) return;
    if (saveState.success) {
      toast.success('Saved to patient record');
      setSelectedPatient(null);
    } else {
      toast.error(saveState.error ?? 'Save failed');
    }
  }, [saveState]);

  const result = useMemo(() => {
    const input: RiskInput = {
      ageOver75: watchedValues.ageOver75 ?? false,
      priorHfHospitalization: watchedValues.priorHfHospitalization ?? false,
      egfrBelow45: watchedValues.egfrBelow45 ?? false,
      elevatedNatriuretic: watchedValues.elevatedNatriuretic ?? false,
      sbpBelow100: watchedValues.sbpBelow100 ?? false,
      diabetes: watchedValues.diabetes ?? false,
      lvefBelow30: watchedValues.lvefBelow30 ?? false,
      ckmStage3or4: watchedValues.ckmStage3or4 ?? false,
      distanceOver50Miles: watchedValues.distanceOver50Miles ?? false,
      livesAloneOrLimitedSupport: watchedValues.livesAloneOrLimitedSupport ?? false,
    };
    return calculateRiskScore(input);
  }, [watchedValues]);

  const grouped = groupByCategory();

  return (
    <div>
      <PrintHeader />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left column: Toggle inputs */}
        <div className="min-w-0 print:hidden" data-testid="toggle-section">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Risk Variables</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                className="print:hidden"
              >
                <Printer className="mr-1 size-4" />
                Print
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => reset()}
                className="print:hidden"
              >
                <RotateCcw className="mr-1 size-4" />
                Reset All
              </Button>
            </div>
          </div>

          {grouped.map(({ category, variables }) => (
            <fieldset key={category} className="mb-6">
              <legend className="mb-2 text-sm font-semibold text-muted-foreground">
                {category}
              </legend>
              <div className="space-y-3">
                {variables.map((v) => (
                  <Controller
                    key={v.key}
                    name={v.key}
                    control={control}
                    render={({ field }) => {
                      const switchId = `switch-${v.key}`;
                      const descId = `desc-${v.key}`;
                      return (
                        <div className="flex items-center gap-3 rounded-lg border p-3">
                          <Switch
                            id={switchId}
                            checked={field.value}
                            onCheckedChange={(val: boolean) => field.onChange(val)}
                            aria-describedby={descId}
                          />
                          <label
                            htmlFor={switchId}
                            className="min-w-0 flex-1 cursor-pointer text-sm"
                          >
                            <span className="font-medium">{v.label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {v.description}
                            </span>
                          </label>
                          <span
                            id={descId}
                            className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium"
                          >
                            +{v.points} pts
                          </span>
                        </div>
                      );
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {/* Right column: Result + Breakdown (sticky on desktop) */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <ResultCard result={result} />
          <div className="mt-6">
            <ScoreBreakdown breakdown={result.breakdown} />
          </div>
        </div>
      </div>

      {/* Patient record integration */}
      {clinicalIntegrationEnabled && <div className="mt-6 border-t pt-6 print:hidden">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Save to Patient Record</h3>
        <PatientSelector
          onSelect={(data) => setSelectedPatient(data.patient)}
          selectedPatient={selectedPatient}
          onClear={() => setSelectedPatient(null)}
        />
        {selectedPatient && result && (
          <form action={saveAction} className="mt-3">
            <input type="hidden" name="patientId" value={selectedPatient.id} />
            <input type="hidden" name="score" value={result.totalScore} />
            <input type="hidden" name="tier" value={result.tier} />
            <input type="hidden" name="inputs" value={JSON.stringify(watchedValues)} />
            <Button type="submit" disabled={isSaving} size="sm">
              {isSaving ? 'Saving...' : `Save Risk Score to ${selectedPatient.full_name}`}
            </Button>
          </form>
        )}
      </div>}
    </div>
  );
}
