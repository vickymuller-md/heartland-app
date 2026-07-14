'use client';

import { useRef, useState, useMemo } from 'react';
import { useForm, useWatch, type DefaultValues } from 'react-hook-form';
import { useReactToPrint } from 'react-to-print';
import { differenceInDays, parseISO } from 'date-fns';
import { useStepper } from '@/hooks/use-stepper';
import { Stepper } from '@/components/titration/stepper';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { PreCallVitals } from './steps/pre-call-vitals';
import { MedicationReview } from './steps/medication-review';
import { SafetyGateCheck } from './steps/safety-gate-check';
import { TitrationDecision } from './steps/titration-decision';
import { PlanFollowup } from './steps/plan-followup';
import { PrintLayout } from './print-layout';
import { Button } from '@/components/ui/button';
import { STEP_DEFINITIONS, DEFAULT_MEDICATIONS } from '@/lib/titration/constants';
import { GDMT_CLASS_KEYWORDS } from '@/lib/dashboard/metrics-constants';
import { evaluateSafetyGates, canProceedPastSafetyGates, getTitrationAction, getPerDrugRecommendations, detectAceiPresence, isArniBeingConsidered } from '@/lib/titration/engine';
import { saveTitrationNote } from '@/lib/integration/actions';
import type { TitrationNoteData } from '@/lib/integration/types';
import type { TitrationFormData } from '@/lib/titration/schema';
import type { VitalSigns, DrugClass, TitrationAction } from '@/lib/titration/types';
import { ChevronLeft, ChevronRight, Printer, Save } from 'lucide-react';
import { toast } from 'sonner';

export function ChecklistWizard() {
  const { currentStep, next, back, isFirst, isLast } = useStepper({ totalSteps: 5 });
  const printRef = useRef<HTMLDivElement>(null);
  const [providerNotes, setProviderNotes] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [labCollectedAt, setLabCollectedAt] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [providerDecision, setProviderDecision] = useState<TitrationAction['action'] | null>(null);

  // Derived lab staleness values (EFFI-04)
  const labDaysOld = labCollectedAt
    ? differenceInDays(new Date(), parseISO(labCollectedAt))
    : null;
  const labsStale = labDaysOld !== null && labDaysOld > 14;

  const {
    register,
    control,
    formState: { errors },
    trigger,
    getValues,
    setValue,
  } = useForm<TitrationFormData>({
    // react-hook-form's DefaultValues<T> already allows fields to be undefined
    // (they become Partial<T>). The Zod schema enforces presence at step
    // transition via trigger(). No manual `as unknown as number` needed.
    defaultValues: {
      symptomsReported: '',
      medications: DEFAULT_MEDICATIONS,
      nextCallDate: '',
      notes: '',
    } satisfies DefaultValues<TitrationFormData>,
  });

  // Handle patient selection — pre-populate vitals and medications
  const handlePatientSelect = (data: SelectedPatientData) => {
    setProviderDecision(null);
    setSelectedPatient(data.patient);
    setPatientName(data.patient.full_name);

    // Pre-populate vitals from latest record
    if (data.latestVitals) {
      if (data.latestVitals.sbp) setValue('sbp', data.latestVitals.sbp);
      if (data.latestVitals.heart_rate) setValue('hr', data.latestVitals.heart_rate);
    }

    // Pre-populate labs from latest lab results
    if (data.latestLabs) {
      if (data.latestLabs.potassium) setValue('potassium', data.latestLabs.potassium);
      if (data.latestLabs.creatinine) setValue('creatinine', data.latestLabs.creatinine);
      if (data.latestLabs.egfr) setValue('egfr', data.latestLabs.egfr);
      setLabCollectedAt(data.latestLabs.collected_at ?? null);
    } else {
      setLabCollectedAt(null);
    }

    // Pre-populate medication list
    if (data.medications.length > 0) {
      setValue('medications', data.medications.map(m => ({
        name: m.name,
        currentDose: m.dosage ?? '',
      })));
    }
  };

  const handlePatientClear = () => {
    setProviderDecision(null);
    setSelectedPatient(null);
    setPatientName('');
    setLabCollectedAt(null);
  };

  // Watch vitals for safety gate evaluation
  const watchedVitals = useWatch({
    control,
    name: ['sbp', 'hr', 'potassium', 'creatinine', 'creatinineBaseline', 'egfr'],
  });

  const vitals: VitalSigns = useMemo(
    () => ({
      sbp: watchedVitals[0] || 0,
      hr: watchedVitals[1] || 0,
      potassium: watchedVitals[2] || 0,
      creatinine: watchedVitals[3] || 0,
      creatinineBaseline: watchedVitals[4] || undefined,
      egfr: watchedVitals[5] || undefined,
    }),
    [watchedVitals]
  );

  // Watch medications for per-drug recommendations
  const watchedMedsValue = useWatch({ control, name: 'medications' });
  const watchedMeds = useMemo(() => watchedMedsValue ?? [], [watchedMedsValue]);

  // Derive active drug classes from medication names
  const activeDrugClasses = useMemo<DrugClass[]>(() => {
    const classes = new Set<DrugClass>();
    for (const med of watchedMeds) {
      if (!med?.name) continue;
      const medLower = med.name.toLowerCase();
      for (const [cls, keywords] of Object.entries(GDMT_CLASS_KEYWORDS) as [DrugClass, string[]][]) {
        if (keywords.some(kw => medLower.includes(kw))) {
          classes.add(cls);
        }
      }
    }
    return Array.from(classes);
  }, [watchedMeds]);

  // Per-drug recommendations and ACEi washout detection
  const perDrugRecs = useMemo(() => {
    if (!vitals || activeDrugClasses.length === 0) return [];
    return getPerDrugRecommendations(vitals, activeDrugClasses);
  }, [vitals, activeDrugClasses]);

  const showAceiWarning = useMemo(() => {
    const medNames = watchedMeds.filter(m => m?.name).map(m => m.name);
    return detectAceiPresence(medNames) && isArniBeingConsidered(activeDrugClasses);
  }, [watchedMeds, activeDrugClasses]);

  const safetyGateResults = useMemo(() => evaluateSafetyGates(vitals), [vitals]);
  const canProceed = useMemo(() => canProceedPastSafetyGates(safetyGateResults), [safetyGateResults]);
  const titrationAction = useMemo(() => getTitrationAction(vitals), [vitals]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `HEARTLAND-Titration-${patientName || 'Checklist'}`,
  });

  const handleSaveNote = async () => {
    if (!selectedPatient || !providerDecision) return;
    setIsSaving(true);

    const noteData: TitrationNoteData = {
      vitals: {
        sbp: vitals.sbp,
        hr: vitals.hr,
        potassium: vitals.potassium || null,
        creatinine: vitals.creatinine || null,
        egfr: vitals.egfr ?? null,
        labDate: labCollectedAt,
        creatinineBaseline: vitals.creatinineBaseline ?? null,
      },
      safetyGateResults: safetyGateResults.map(g => ({
        parameter: g.parameter,
        status: g.status,
      })),
      titrationAction: {
        action: providerDecision,
        details: `Provider-selected decision after review. Advisory signal: ${titrationAction.action.toUpperCase()} — ${titrationAction.details}`,
      },
      perDrugRecommendations: perDrugRecs.map(r => ({
        drugClass: r.drugClass,
        action: r.action,
        reason: r.reason,
      })),
      symptomsReported: getValues('symptomsReported') || undefined,
      providerNotes: providerNotes,
      nextCallDate: getValues('nextCallDate') || '',
    };

    const result = await saveTitrationNote(selectedPatient.id, noteData);
    setIsSaving(false);

    if (result.success) {
      toast.success(`Titration note saved to ${selectedPatient.full_name}'s record`);
    } else {
      toast.error(result.error ?? 'Failed to save note');
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      const valid = await trigger(['sbp', 'hr', 'potassium', 'creatinine']);
      if (!valid) return;
    }
    if (currentStep === 2 && !canProceed) return;
    if (currentStep === 3) {
      if (!providerDecision) {
        toast.error('Select the provider final decision before continuing');
        return;
      }
      if (providerDecision !== titrationAction.action && providerNotes.trim().length < 3) {
        toast.error('Document the reason when the final decision differs from the advisory signal');
        return;
      }
    }
    next();
  };

  const isNextDisabled = (currentStep === 2 && !canProceed) || (currentStep === 3 && !providerDecision);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <PreCallVitals register={register} errors={errors} labsStale={labsStale} labDaysOld={labDaysOld} />;
      case 1:
        return <MedicationReview control={control} patientId={selectedPatient?.id} />;
      case 2:
        return <SafetyGateCheck vitals={vitals} />;
      case 3:
        return (
          <TitrationDecision
            vitals={vitals}
            providerNotes={providerNotes}
            onNotesChange={setProviderNotes}
            selectedAction={providerDecision}
            onActionChange={setProviderDecision}
            perDrugRecommendations={perDrugRecs}
            showAceiWarning={showAceiWarning}
          />
        );
      case 4:
        return <PlanFollowup register={register} errors={errors} />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Screen UI */}
      <div className="print:hidden space-y-6">
        {/* Patient Selector */}
        <PatientSelector
          onSelect={handlePatientSelect}
          selectedPatient={selectedPatient}
          onClear={handlePatientClear}
        />

        <Stepper steps={STEP_DEFINITIONS} currentStep={currentStep} />

        <div className="min-h-[400px]">{renderStep()}</div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={back}
            disabled={isFirst}
            className="gap-1"
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>

          <div className="flex gap-2">
            {isLast ? (
              <>
                <Button
                  type="button"
                  onClick={() => handlePrint()}
                  className="gap-1"
                >
                  <Printer className="size-4" />
                  Export Checklist as PDF
                </Button>
                {selectedPatient && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSaveNote}
                    disabled={isSaving}
                    className="gap-1"
                  >
                    <Save className="size-4" />
                    {isSaving ? 'Saving...' : `Save Clinical Note to ${selectedPatient.full_name}`}
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="button"
                onClick={handleNext}
                disabled={isNextDisabled}
                className="gap-1"
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Print-only layout */}
      <div ref={printRef}>
        <PrintLayout
          patientName={patientName || undefined}
          vitals={vitals}
          medications={getValues('medications') || []}
          safetyGateResults={safetyGateResults}
          titrationAction={providerDecision ? {
            action: providerDecision,
            details: `Provider-selected decision. Advisory signal: ${titrationAction.action.toUpperCase()} — ${titrationAction.details}`,
          } : {
            action: titrationAction.action,
            details: `No provider final decision recorded. Advisory signal only: ${titrationAction.details}`,
          }}
          providerNotes={providerNotes}
          followUpPlan={{
            nextCallDate: getValues('nextCallDate'),
            notes: getValues('notes'),
          }}
          timestamp={new Date()}
        />
      </div>
    </>
  );
}
