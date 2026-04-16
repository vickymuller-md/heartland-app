'use client';

import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Phone, FlaskConical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TitrationFormData } from '@/lib/titration/schema';

interface PreCallVitalsProps {
  register: UseFormRegister<TitrationFormData>;
  errors: FieldErrors<TitrationFormData>;
  labsStale?: boolean;
  labDaysOld?: number | null;
}

const patientReportedFields = [
  {
    name: 'sbp' as const,
    label: 'Systolic BP (mmHg)',
    helper: 'Normal range: 100-140 mmHg',
    step: 1,
    placeholder: '120',
  },
  {
    name: 'hr' as const,
    label: 'Heart Rate (bpm)',
    helper: 'Normal range: 60-100 bpm',
    step: 1,
    placeholder: '70',
  },
];

const labResultFields = [
  {
    name: 'potassium' as const,
    label: 'Potassium (mEq/L)',
    helper: 'Normal range: 3.5-5.0 mEq/L',
    step: 0.1,
    placeholder: '4.0',
  },
  {
    name: 'creatinine' as const,
    label: 'Creatinine (mg/dL)',
    helper: 'Normal range: 0.7-1.3 mg/dL',
    step: 0.1,
    placeholder: '1.0',
  },
  {
    name: 'creatinineBaseline' as const,
    label: 'Baseline Creatinine (mg/dL)',
    helper: 'Optional. Used to calculate % increase for safety gate.',
    step: 0.1,
    placeholder: '1.0',
  },
  {
    name: 'egfr' as const,
    label: 'eGFR (mL/min/1.73m\u00B2)',
    helper: 'Optional. Used for renal safety gate per-drug thresholds.',
    step: 1,
    placeholder: '60',
  },
];

export function PreCallVitals({ register, errors, labsStale, labDaysOld }: PreCallVitalsProps) {
  return (
    <div className="space-y-6">
      {labsStale && labDaysOld !== null && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <span className="mt-0.5 shrink-0 font-bold">!</span>
          <div>
            <p className="font-semibold">Lab values may be outdated</p>
            <p className="mt-0.5 text-amber-700">
              K+ and creatinine were collected {labDaysOld} days ago (older than 14 days).
              Consider ordering updated labs before adjusting medications.
            </p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold">Pre-Call Vitals</h2>
        <p className="text-sm text-muted-foreground">
          Gather vitals before initiating the titration call. Patient reports BP and HR by phone;
          lab values come from the most recent bloodwork in the chart.
        </p>
      </div>

      {/* Section 1: Patient-reported vitals (by phone) */}
      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-blue-900">
            Patient Reports by Phone
          </h3>
        </div>
        <p className="text-xs text-blue-700">
          Ask the patient to measure and read these values during the call.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {patientReportedFields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              <Input
                id={field.name}
                type="number"
                step={field.step}
                placeholder={field.placeholder}
                aria-invalid={!!errors[field.name]}
                className="bg-white"
                {...register(field.name, { valueAsNumber: true })}
              />
              {errors[field.name] && (
                <p className="text-xs text-destructive">{errors[field.name]?.message}</p>
              )}
              <p className="text-xs text-muted-foreground">{field.helper}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Lab results (from chart/EHR) */}
      <div className="rounded-lg border border-purple-200 bg-purple-50/50 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-purple-600" />
          <h3 className="text-sm font-semibold text-purple-900">
            Lab Results from Chart
          </h3>
        </div>
        <p className="text-xs text-purple-700">
          Enter the most recent lab values from the patient&apos;s medical record.
          These are NOT expected from the patient by phone.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {labResultFields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={field.name}>{field.label}</Label>
              <Input
                id={field.name}
                type="number"
                step={field.step}
                placeholder={field.placeholder}
                aria-invalid={!!errors[field.name]}
                className="bg-white"
                {...register(field.name, { valueAsNumber: true })}
              />
              {errors[field.name] && (
                <p className="text-xs text-destructive">{errors[field.name]?.message}</p>
              )}
              <p className="text-xs text-muted-foreground">{field.helper}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 3: Patient-reported symptoms (optional) */}
      <div className="space-y-1.5">
        <Label htmlFor="symptomsReported">Symptoms Reported by Patient (optional)</Label>
        <textarea
          id="symptomsReported"
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          rows={2}
          placeholder="e.g., occasional dizziness, no new edema, tolerating medications well..."
          {...register('symptomsReported')}
        />
        <p className="text-xs text-muted-foreground">
          Brief summary of symptoms the patient reports during the phone call.
        </p>
      </div>
    </div>
  );
}
