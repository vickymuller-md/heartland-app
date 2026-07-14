"use client";

import { useState, useMemo, useCallback, useEffect, useActionState } from "react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import {
  CATEGORY_DEFINITIONS,
  TIER_COLORS,
} from "@/lib/tier-selector/constants";
import type {
  TierLevel,
  CategoryAssessment,
  TierResult,
} from "@/lib/tier-selector/types";
import { assessTier } from "@/lib/tier-selector/engine";
import { PatientSelector, type SelectedPatientData } from "@/components/shared/patient-selector";
import { saveFacilityTier } from "@/lib/integration/actions";
import { TierResultCard } from "./tier-result";
import { ImplementationChecklist } from "./checklist";
import { QualityMetricsTable } from "./quality-metrics";
import { ASMReadiness } from "./asm-readiness";
import { PrintLayout } from "./print-layout";

/** Map category ID to a form-friendly key */
const CATEGORY_KEYS = CATEGORY_DEFINITIONS.map((c) => c.id);

export function TierQuestionnaire() {
  const [selections, setSelections] = useState<
    Record<string, TierLevel | undefined>
  >({});

  // Patient integration state
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [saveState, saveAction, isSaving] = useActionState(saveFacilityTier, null);

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

  const handleSelect = useCallback(
    (categoryId: string, level: TierLevel) => {
      setSelections((prev) => ({ ...prev, [categoryId]: level }));
    },
    [],
  );

  // Count answered categories
  const answeredCount = useMemo(
    () =>
      CATEGORY_KEYS.filter((id) => selections[id] !== undefined).length,
    [selections],
  );

  // Compute result when all 8 are answered
  const result: TierResult | null = useMemo(() => {
    if (answeredCount < 8) return null;
    const categories: CategoryAssessment[] = CATEGORY_DEFINITIONS.map(
      (cat) => ({
        categoryId: cat.id,
        categoryLabel: cat.label,
        selectedLevel: selections[cat.id]!,
        description:
          cat.levels[selections[cat.id]!].description,
      }),
    );
    return assessTier(categories);
  }, [answeredCount, selections]);

  return (
    <>
      {/* Screen layout */}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr] print:hidden">
        {/* Left column: Accordion form */}
        <div>
          <Accordion
            multiple
            defaultValue={CATEGORY_KEYS}
          >
            {CATEGORY_DEFINITIONS.map((cat) => (
              <AccordionItem key={cat.id} value={cat.id}>
                <AccordionTrigger className="text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{cat.label}</span>
                    {selections[cat.id] !== undefined && (
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TIER_COLORS[selections[cat.id]!].badge}`}
                      >
                        Tier {selections[cat.id]}
                      </span>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {cat.description}
                  </p>
                  <RadioGroup
                    value={
                      selections[cat.id] !== undefined
                        ? String(selections[cat.id])
                        : undefined
                    }
                    onValueChange={(val: string) =>
                      handleSelect(cat.id, Number(val) as TierLevel)
                    }
                    className="space-y-2"
                  >
                    {([1, 2, 3] as const).map((level) => (
                      <label
                        key={level}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50 ${
                          selections[cat.id] === level
                            ? `${TIER_COLORS[level].border} ${TIER_COLORS[level].bg}`
                            : "border-gray-200"
                        }`}
                      >
                        <RadioGroupItem
                          value={String(level)}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <span className="font-medium text-sm">
                            {cat.levels[level].label}
                          </span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {cat.levels[level].description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Right column: Progress + Results */}
        <div className="lg:sticky lg:top-6 lg:self-start space-y-6">
          {/* Progress indicator */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700">
              {answeredCount} of 8 categories assessed
            </p>
            <div className="mt-2 h-2 w-full rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-slate-700 transition-all duration-300"
                style={{ width: `${(answeredCount / 8) * 100}%` }}
              />
            </div>
            {answeredCount < 8 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Complete all 8 categories to see your tier result.
              </p>
            )}
          </div>

          {/* Result sections */}
          {result && (
            <>
              <TierResultCard result={result} />
              <ImplementationChecklist
                result={result}
                tierLevel={result.overallTier}
              />
              <QualityMetricsTable tierLevel={result.overallTier} />
              <ASMReadiness />
            </>
          )}
        </div>
      </div>

      {/* Patient record integration */}
      <div className="mt-6 border-t pt-6 print:hidden">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Save to Patient Record</h3>
        <PatientSelector
          onSelect={(data) => setSelectedPatient(data.patient)}
          selectedPatient={selectedPatient}
          onClear={() => setSelectedPatient(null)}
        />
        {selectedPatient && result && (
          <form action={saveAction} className="mt-3">
            <input type="hidden" name="patientId" value={selectedPatient.id} />
            <input type="hidden" name="facilityTier" value={String(result.overallTier)} />
            <Button type="submit" disabled={isSaving} size="sm">
              {isSaving ? 'Saving...' : `Save Tier ${result.overallTier} to ${selectedPatient.full_name}`}
            </Button>
          </form>
        )}
      </div>

      {/* Print layout */}
      {result && <PrintLayout result={result} />}
    </>
  );
}
