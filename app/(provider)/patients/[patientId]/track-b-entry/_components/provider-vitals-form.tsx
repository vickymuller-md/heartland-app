'use client';

/**
 * Track B: Provider Vitals Entry Form
 * Requirement: TRKB-02
 *
 * Allows providers to transcribe paper diary readings for Track B patients.
 * Uses useActionState with submitVitalsAsProvider Server Action.
 * Follows existing patient vitals form patterns (48px tap targets, 16px+ fonts).
 */

import { useActionState, useState } from 'react';
import { submitVitalsAsProvider } from '@/lib/vitals/actions';
import { SYMPTOM_SEVERITY } from '@/lib/vitals/constants';
import type { VitalsActionState } from '@/lib/vitals/types';
import { AlertTriangle, CheckCircle } from 'lucide-react';

interface ProviderVitalsFormProps {
  patientId: string;
}

export default function ProviderVitalsForm({ patientId }: ProviderVitalsFormProps) {
  const [state, formAction, isPending] = useActionState<VitalsActionState | null, FormData>(
    submitVitalsAsProvider,
    null
  );
  const [weightUnit, setWeightUnit] = useState<'lbs' | 'kg'>('lbs');
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().split('T')[0]);

  // Success state
  if (state?.success) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-green-300 bg-green-50 p-6 text-center">
          <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
          <h2 className="text-xl font-bold text-green-800 mb-2">Vitals Saved Successfully</h2>
          <p className="text-base text-green-700">
            The diary entry has been recorded for this patient.
          </p>
        </div>

        {state.redFlags && state.redFlags.length > 0 && (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4" role="alert">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h3 className="font-semibold text-amber-800">Red Flags Detected</h3>
            </div>
            <ul className="space-y-1 text-sm text-amber-800">
              {state.redFlags.map((flag) => (
                <li key={flag.id}>
                  <span className="font-medium">{flag.message}</span> &mdash; {flag.action}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full min-h-[48px] text-base font-semibold bg-blue-600 text-white rounded-lg py-3"
        >
          Enter Another Reading
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-8">
      {/* Hidden fields */}
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="weightUnit" value={weightUnit} />
      <input type="hidden" name="recordedAt" value={`${recordedDate}T12:00:00Z`} />

      {/* General error */}
      {state?.error && (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
          <p className="text-base text-red-700">{state.error}</p>
        </div>
      )}

      {/* Date of Reading */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Date of Reading</h2>
        <div>
          <label htmlFor="recordedDate" className="text-base font-semibold text-gray-900 mb-2 block">
            Date
          </label>
          <input
            type="date"
            id="recordedDate"
            value={recordedDate}
            onChange={(e) => setRecordedDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="w-full min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
          />
        </div>
      </section>

      {/* Vitals Section */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Vitals</h2>
        <div className="space-y-4">
          {/* Weight + Unit */}
          <div>
            <label htmlFor="weight" className="text-base font-semibold text-gray-900 mb-2 block">
              Weight
            </label>
            <div className="flex gap-3 items-start">
              <input
                type="number"
                id="weight"
                name="weight"
                step="0.1"
                placeholder="e.g., 165"
                className="flex-1 min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
              />
              <div className="flex rounded-lg border-2 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setWeightUnit('lbs')}
                  className={`min-h-[48px] px-4 text-base font-medium transition-colors ${
                    weightUnit === 'lbs'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  lbs
                </button>
                <button
                  type="button"
                  onClick={() => setWeightUnit('kg')}
                  className={`min-h-[48px] px-4 text-base font-medium transition-colors ${
                    weightUnit === 'kg'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  kg
                </button>
              </div>
            </div>
            {state?.errors?.weight && (
              <p className="text-base text-red-600 mt-1">{state.errors.weight[0]}</p>
            )}
          </div>

          {/* Systolic BP */}
          <div>
            <label htmlFor="sbp" className="text-base font-semibold text-gray-900 mb-2 block">
              Systolic Blood Pressure (top number)
            </label>
            <input
              type="number"
              id="sbp"
              name="sbp"
              placeholder="e.g., 120"
              className="w-full min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
            />
            {state?.errors?.sbp && (
              <p className="text-base text-red-600 mt-1">{state.errors.sbp[0]}</p>
            )}
          </div>

          {/* Diastolic BP */}
          <div>
            <label htmlFor="dbp" className="text-base font-semibold text-gray-900 mb-2 block">
              Diastolic Blood Pressure (bottom number)
            </label>
            <input
              type="number"
              id="dbp"
              name="dbp"
              placeholder="e.g., 80"
              className="w-full min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
            />
            {state?.errors?.dbp && (
              <p className="text-base text-red-600 mt-1">{state.errors.dbp[0]}</p>
            )}
          </div>

          {/* Heart Rate */}
          <div>
            <label htmlFor="heartRate" className="text-base font-semibold text-gray-900 mb-2 block">
              Heart Rate
            </label>
            <input
              type="number"
              id="heartRate"
              name="heartRate"
              placeholder="e.g., 72"
              className="w-full min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
            />
            {state?.errors?.heartRate && (
              <p className="text-base text-red-600 mt-1">{state.errors.heartRate[0]}</p>
            )}
          </div>

          {/* SpO2 (optional) */}
          <div>
            <label htmlFor="spo2" className="text-base font-semibold text-gray-900 mb-2 block">
              SpO2{' '}
              <span className="text-sm font-normal text-gray-500">(optional)</span>
            </label>
            <input
              type="number"
              id="spo2"
              name="spo2"
              placeholder="e.g., 97"
              className="w-full min-h-[48px] text-base px-4 py-3 border-2 rounded-lg"
            />
            {state?.errors?.spo2 && (
              <p className="text-base text-red-600 mt-1">{state.errors.spo2[0]}</p>
            )}
          </div>
        </div>
      </section>

      {/* Symptoms Section */}
      <section>
        <h2 className="text-xl font-bold text-gray-900 mb-4">Symptoms</h2>
        <div className="space-y-6">
          {/* Dyspnea */}
          <div>
            <label className="text-base font-semibold text-gray-900 mb-3 block">
              Shortness of Breath
            </label>
            <div className="space-y-2" role="radiogroup" aria-label="Shortness of Breath">
              {SYMPTOM_SEVERITY.map((level) => (
                <label
                  key={level.value}
                  className="flex items-center gap-3 min-h-[48px] px-4 py-3 border-2 rounded-lg text-base cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    name="dyspnea"
                    value={String(level.value)}
                    defaultChecked={level.value === 0}
                    className="h-5 w-5 text-blue-600 accent-blue-600"
                  />
                  <div>
                    <span className="font-medium">{level.label}</span>
                    <span className="text-gray-500 ml-2 text-sm">{level.description}</span>
                  </div>
                </label>
              ))}
            </div>
            {state?.errors?.dyspnea && (
              <p className="text-base text-red-600 mt-1">{state.errors.dyspnea[0]}</p>
            )}
          </div>

          {/* Edema */}
          <div>
            <label className="text-base font-semibold text-gray-900 mb-3 block">
              Swelling (Ankles/Legs)
            </label>
            <div className="space-y-2" role="radiogroup" aria-label="Swelling">
              {SYMPTOM_SEVERITY.map((level) => (
                <label
                  key={level.value}
                  className="flex items-center gap-3 min-h-[48px] px-4 py-3 border-2 rounded-lg text-base cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    name="edema"
                    value={String(level.value)}
                    defaultChecked={level.value === 0}
                    className="h-5 w-5 text-blue-600 accent-blue-600"
                  />
                  <div>
                    <span className="font-medium">{level.label}</span>
                    <span className="text-gray-500 ml-2 text-sm">{level.description}</span>
                  </div>
                </label>
              ))}
            </div>
            {state?.errors?.edema && (
              <p className="text-base text-red-600 mt-1">{state.errors.edema[0]}</p>
            )}
          </div>

          {/* Orthopnea */}
          <div>
            <label className="text-base font-semibold text-gray-900 mb-3 block">
              Trouble Breathing Lying Down
            </label>
            <div className="flex gap-2" role="radiogroup" aria-label="Trouble Breathing Lying Down">
              <label className="flex-1 flex items-center justify-center gap-2 min-h-[48px] px-4 py-3 border-2 rounded-lg text-base cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="orthopnea"
                  value="false"
                  defaultChecked
                  className="h-5 w-5 text-blue-600 accent-blue-600"
                />
                <span className="font-medium">No</span>
              </label>
              <label className="flex-1 flex items-center justify-center gap-2 min-h-[48px] px-4 py-3 border-2 rounded-lg text-base cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors">
                <input
                  type="radio"
                  name="orthopnea"
                  value="true"
                  className="h-5 w-5 text-blue-600 accent-blue-600"
                />
                <span className="font-medium">Yes</span>
              </label>
            </div>
            {state?.errors?.orthopnea && (
              <p className="text-base text-red-600 mt-1">{state.errors.orthopnea[0]}</p>
            )}
          </div>

          {/* Fatigue */}
          <div>
            <label className="text-base font-semibold text-gray-900 mb-3 block">
              Tiredness (Fatigue)
            </label>
            <div className="space-y-2" role="radiogroup" aria-label="Tiredness">
              {SYMPTOM_SEVERITY.map((level) => (
                <label
                  key={level.value}
                  className="flex items-center gap-3 min-h-[48px] px-4 py-3 border-2 rounded-lg text-base cursor-pointer has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    name="fatigue"
                    value={String(level.value)}
                    defaultChecked={level.value === 0}
                    className="h-5 w-5 text-blue-600 accent-blue-600"
                  />
                  <div>
                    <span className="font-medium">{level.label}</span>
                    <span className="text-gray-500 ml-2 text-sm">{level.description}</span>
                  </div>
                </label>
              ))}
            </div>
            {state?.errors?.fatigue && (
              <p className="text-base text-red-600 mt-1">{state.errors.fatigue[0]}</p>
            )}
          </div>
        </div>
      </section>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full min-h-[48px] text-base font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed py-3"
      >
        {isPending ? 'Saving...' : 'Save Vitals for Patient'}
      </button>
    </form>
  );
}
