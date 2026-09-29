'use client';

import { useRef, useState, useMemo, useEffect } from 'react';
import { useForm, useWatch, type DefaultValues } from 'react-hook-form';
import { useReactToPrint } from 'react-to-print';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSessionBoundExport } from '@/lib/exports/use-session-bound-export';
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
import { evaluateSafetyGates, canProceedPastSafetyGates, getTitrationAction, getPerDrugRecommendations, detectAceiPresence, detectFinerenonePresence, isArniBeingConsidered } from '@/lib/titration/engine';
import { saveTitrationNote } from '@/lib/integration/actions';
import type { TitrationNoteData, SelectedLabs } from '@/lib/integration/types';
import { formatTitrationSources } from '@/lib/integration/utils';
import { titrationFormSchema, vitalsSchema, type TitrationFormData } from '@/lib/titration/schema';
import type { VitalSigns, DrugClass, TitrationAction } from '@/lib/titration/types';
import { ChevronLeft, ChevronRight, Printer, Save } from 'lucide-react';
import { toast } from 'sonner';

interface WizardProps { clinicalIntegrationEnabled?: boolean; expectedProviderId?: string; contextId?: string }
export function ChecklistWizard({ clinicalIntegrationEnabled = false, expectedProviderId, contextId }: WizardProps) {
  return clinicalIntegrationEnabled && expectedProviderId
    ? <AuthenticatedChecklist key={JSON.stringify([expectedProviderId, contextId])} providerId={expectedProviderId} />
    : <ChecklistContent />;
}
function AuthenticatedChecklist({ providerId }: { providerId: string }) {
  const session = useSessionBoundExport(providerId);
  if (session.sessionError) return <p role="alert">Checklist session changed. Reload the page; linked data were removed.</p>;
  if (!session.sessionReady) return <p role="status">Verifying checklist session…</p>;
  return <ChecklistContent providerId={providerId} session={session} />;
}
function ChecklistContent({ providerId, session }: { providerId?: string; session?: ReturnType<typeof useSessionBoundExport> }) {
  const { currentStep, next, back, goTo, isFirst, isLast } = useStepper({ totalSteps: 5 });
  const printRef = useRef<HTMLDivElement>(null);
  const [providerNotes, setProviderNotes] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [laboratorySnapshots, setLaboratorySnapshots] = useState<SelectedLabs | null>(null);
  const [sourceReadAt, setSourceReadAt] = useState<string | null>(null);
  const [sourceMedications, setSourceMedications] = useState<SelectedPatientData['medications']>([]);
  const [formGeneration, setFormGeneration] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<'saved' | 'unknown' | null>(null);
  const saving = useRef(false);
  const alive = useRef(true);
  const formEpoch = useRef(0);
  const [providerDecision, setProviderDecision] = useState<TitrationAction['action'] | null>(null);

  const {
    register,
    control,
    formState: { errors },
    trigger,
    getValues,
    reset,
    watch,
  } = useForm<TitrationFormData>({
    resolver: zodResolver(titrationFormSchema),
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
  const invalidateContent = session?.invalidateContent;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const subscription = watch((_values, { name }) => {
      formEpoch.current += 1;
      invalidateContent?.();
      if (!name || /^(sbp|hr|potassium|creatinine|creatinineBaseline|egfr|medications)(\.|$)/.test(name)) setProviderDecision(null);
      setSaveOutcome((previous) => previous === 'unknown' ? previous : null);
    });
    return () => subscription.unsubscribe();
  }, [watch, invalidateContent]);

  const handlePatientClear = () => {
    formEpoch.current += 1;
    // Uncontrolled numeric inputs can retain DOM values when reset receives undefined.
    // A fresh input subtree is required even when refreshing the same patient.
    setFormGeneration((previous) => previous + 1);
    invalidateContent?.(); goTo(0); reset({ symptomsReported: '', medications: [], nextCallDate: '', notes: '' });
    setProviderDecision(null); setProviderNotes(''); setSelectedPatient(null); setPatientName('');
    setLaboratorySnapshots(null); setSourceReadAt(null); setSourceMedications([]); setSaveOutcome(null);
  };

  // Handle patient selection — pre-populate vitals and medications
  const handlePatientSelect = (data: SelectedPatientData) => {
    handlePatientClear();
    if (!providerId || data.actorId !== providerId || !data.laboratorySnapshots) return;
    setProviderDecision(null);
    setSelectedPatient(data.patient);
    setPatientName(data.patient.full_name);

    setLaboratorySnapshots(data.laboratorySnapshots); setSourceReadAt(data.sourceReadAt); setSourceMedications(data.medications);
    reset({ sbp: data.latestVitals?.sbp ?? undefined, hr: data.latestVitals?.heart_rate ?? undefined,
      potassium: data.laboratorySnapshots.potassium.prefill ?? undefined,
      creatinine: data.laboratorySnapshots.creatinine.prefill ?? undefined,
      egfr: data.laboratorySnapshots.egfr.prefill ?? undefined,
      medications: data.medications.map((medication) => ({ name: medication.name, currentDose: medication.dosage ?? '' })),
      symptomsReported: '', nextCallDate: '', notes: '' });
  };

  // Watch vitals for safety gate evaluation
  const watchedVitals = useWatch({
    control,
    name: ['sbp', 'hr', 'potassium', 'creatinine', 'creatinineBaseline', 'egfr'],
  });

  const vitals: VitalSigns | null = useMemo(() => {
    const parsed = vitalsSchema.safeParse({ sbp: watchedVitals[0], hr: watchedVitals[1], potassium: watchedVitals[2], creatinine: watchedVitals[3],
      creatinineBaseline: Number.isNaN(watchedVitals[4]) ? undefined : watchedVitals[4], egfr: Number.isNaN(watchedVitals[5]) ? undefined : watchedVitals[5] });
    return parsed.success ? parsed.data : null;
  }, [watchedVitals]);

  // Watch medications for per-drug recommendations
  const watchedMedsValue = useWatch({ control, name: 'medications' });
  const watchedMeds = useMemo(() => watchedMedsValue ?? [], [watchedMedsValue]);

  // Derive active drug classes from medication names
  const activeDrugClasses = useMemo<DrugClass[]>(() => {
    const classes = new Set<DrugClass>();
    for (const med of watchedMeds) {
      if (!med?.name) continue;
      // The non-steroidal MRA follows the KERENDIA label, not the steroidal
      // MRA rules, so it must not be folded into the 'MRA' class.
      if (detectFinerenonePresence([med.name])) {
        classes.add('Finerenone');
        continue;
      }
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

  const safetyGateResults = useMemo(() => vitals ? evaluateSafetyGates(vitals) : [], [vitals]);
  const canProceed = useMemo(() => !!vitals && canProceedPastSafetyGates(safetyGateResults), [vitals, safetyGateResults]);
  const titrationAction = useMemo(() => vitals ? getTitrationAction(vitals) : null, [vitals]);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `HEARTLAND-Titration-${patientName || 'Checklist'}`,
  });

  const handleSaveNote = async () => {
    if (!selectedPatient || !providerDecision || !vitals || !titrationAction || !session || !providerId
      || saving.current || saveOutcome || !decisionPermitted) return;
    const ticket = session.epoch.current; const formTicket = formEpoch.current;
    const current = () => alive.current && formEpoch.current === formTicket && session.isCurrent(ticket);
    saving.current = true; setIsSaving(true);
    let dispatched = false;
    try {
      if (!await trigger() || !current()) return;
      await session.verifySession(ticket);
      if (!current()) return;
      const noteData: TitrationNoteData = {
      vitals: {
        sbp: vitals.sbp,
        hr: vitals.hr,
        potassium: vitals.potassium,
        creatinine: vitals.creatinine,
        egfr: vitals.egfr ?? null,
        creatinineBaseline: vitals.creatinineBaseline ?? null,
      },
      laboratorySnapshots, sourceReadAt,
      safetyGateResults: safetyGateResults.map(g => ({
        parameter: g.parameter,
        status: g.status,
      })),
      titrationAction: {
        action: providerDecision,
        details: `Manually selected in this draft. Advisory signal: ${titrationAction.action.toUpperCase()} — ${titrationAction.details}`,
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

      dispatched = true;
      const result = await saveTitrationNote(selectedPatient.id, noteData, providerId);
      if (!current()) return;
      await session.verifySession(ticket);
      if (!current()) return;
      if (result.success) { setSaveOutcome('saved'); toast.success('Draft note saved; this does not confirm laboratory review, contact or completed care.'); }
      else { if (result.outcome !== 'not_saved') setSaveOutcome('unknown'); toast.error(result.error ?? 'Note status could not be verified. Check the patient record.'); }
    } catch {
      if (current()) {
        if (dispatched) setSaveOutcome('unknown');
        toast.error(dispatched ? 'The note may have been saved. Check the patient record before submitting another note.' : 'The session could not be verified. Reload the page.');
      }
    } finally { saving.current = false; if (alive.current) setIsSaving(false); }
  };

  const handleNext = async () => {
    const ticket = formEpoch.current;
    if (currentStep === 0) {
      const valid = await trigger(['sbp', 'hr', 'potassium', 'creatinine', 'creatinineBaseline', 'egfr']);
      if (!valid || !alive.current || ticket !== formEpoch.current) return;
    }
    if (currentStep === 1 && (!await trigger('medications') || !alive.current || ticket !== formEpoch.current)) return;
    if (currentStep === 2 && !canProceed) return;
    if (currentStep === 3) {
      if (!providerDecision || !titrationAction) {
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

  const decisionPermitted = !!providerDecision && !!titrationAction
    && (providerDecision === titrationAction.action || providerNotes.trim().length >= 3);
  const isNextDisabled = (currentStep === 2 && !canProceed) || (currentStep === 3 && !providerDecision);

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <PreCallVitals register={register} errors={errors} laboratorySnapshots={laboratorySnapshots} />;
      case 1:
        return <MedicationReview control={control} patientMedications={sourceMedications} />;
      case 2:
        return vitals ? <SafetyGateCheck vitals={vitals} /> : <p role="alert">Return to Pre-Call Vitals and verify the missing or invalid entries.</p>;
      case 3:
        return vitals ? (
          <TitrationDecision
            vitals={vitals}
            providerNotes={providerNotes}
            onNotesChange={(value) => { formEpoch.current += 1; invalidateContent?.(); setProviderNotes(value); setSaveOutcome(null); }}
            selectedAction={providerDecision}
            onActionChange={(value) => { formEpoch.current += 1; invalidateContent?.(); setProviderDecision(value); setSaveOutcome(null); }}
            perDrugRecommendations={perDrugRecs}
            showAceiWarning={showAceiWarning}
          />
        ) : <p role="alert">Return to Pre-Call Vitals and verify the missing or invalid entries.</p>;
      case 4:
        return <PlanFollowup register={register} errors={errors} />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* Screen UI */}
      <fieldset disabled={isSaving || saveOutcome === 'unknown'} className="print:hidden space-y-6">
        {/* Patient Selector */}
        {providerId && <PatientSelector
          onSelect={handlePatientSelect}
          selectedPatient={selectedPatient}
          onClear={handlePatientClear}
          expectedActorId={providerId}
          includeLaboratories
        />}

        <Stepper steps={STEP_DEFINITIONS} currentStep={currentStep} />
        {providerNotes.length > 2000 && <p role="alert">Provider notes exceed 2,000 characters. Shorten them explicitly before saving; text will not be silently truncated.</p>}

        <div key={formGeneration} className="min-h-[400px]">{renderStep()}</div>

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
                  onClick={() => {
                    if (!vitals || !decisionPermitted) return;
                    if (session) session.beginPrint(printRef.current, `HEARTLAND-Titration-${patientName || 'Checklist'}`);
                    else handlePrint();
                  }}
                  disabled={!vitals || !decisionPermitted || session?.printBusy}
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
                    disabled={isSaving || !!saveOutcome || !decisionPermitted || !vitals}
                    className="gap-1"
                  >
                    <Save className="size-4" />
                    {isSaving ? 'Saving...' : `Save Draft Note to ${selectedPatient.full_name}`}
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
      </fieldset>
      {saveOutcome === 'unknown' && <p role="alert">The note may have been saved. This form is locked against another submission. Check the patient record, then reload the page before preparing another note.</p>}
      {saveOutcome === 'saved' && <p role="status">Draft note saved; not confirmation of laboratory review, patient contact or completed care.</p>}
      {session?.printError && <p role="alert">{session.printError}</p>}

      {/* Print-only layout */}
      <div ref={printRef}>
        {vitals && titrationAction && decisionPermitted && <PrintLayout
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
          laboratoryProvenance={formatTitrationSources({ vitals, laboratorySnapshots, sourceReadAt })}
        />}
      </div>
    </>
  );
}
