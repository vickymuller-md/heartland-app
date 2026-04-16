'use client';

/**
 * HEARTLAND Medication Form -- Add/Edit medication
 *
 * Uses useActionState for Server Action integration.
 * Elderly-friendly: 48px tap targets, 16px+ fonts, clear labels.
 */

import { useActionState, useEffect } from 'react';
import { addMedication, updateMedication } from '@/lib/medications/actions';
import { FREQUENCY_OPTIONS, TIMING_PRESETS } from '@/lib/medications/constants';
import type { MedicationRow, MedicationActionState } from '@/lib/medications/types';

interface MedicationFormProps {
  mode: 'add' | 'edit';
  medication?: MedicationRow;
  onSuccess?: () => void;
}

export function MedicationForm({
  mode,
  medication,
  onSuccess,
}: MedicationFormProps) {
  const action = mode === 'add' ? addMedication : updateMedication;
  const [state, formAction, isPending] = useActionState<
    MedicationActionState | null,
    FormData
  >(action, null);

  // Close dialog on success
  useEffect(() => {
    if (state?.success && onSuccess) {
      onSuccess();
    }
  }, [state?.success, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      {/* Hidden ID for edit mode */}
      {mode === 'edit' && medication && (
        <input type="hidden" name="id" value={medication.id} />
      )}

      {/* Medication name */}
      <div className="space-y-1">
        <label
          htmlFor="med-name"
          className="block text-base font-medium text-gray-900"
        >
          Medication Name
        </label>
        <input
          id="med-name"
          name="name"
          type="text"
          placeholder="e.g., Carvedilol"
          defaultValue={medication?.name ?? ''}
          className="w-full min-h-[48px] px-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          required
        />
        {state?.errors?.name && (
          <p className="text-base text-red-600">{state.errors.name[0]}</p>
        )}
      </div>

      {/* Dosage */}
      <div className="space-y-1">
        <label
          htmlFor="med-dosage"
          className="block text-base font-medium text-gray-900"
        >
          Dosage
        </label>
        <input
          id="med-dosage"
          name="dosage"
          type="text"
          placeholder="e.g., 25 mg BID"
          defaultValue={medication?.dosage ?? ''}
          className="w-full min-h-[48px] px-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          required
        />
        {state?.errors?.dosage && (
          <p className="text-base text-red-600">{state.errors.dosage[0]}</p>
        )}
      </div>

      {/* Frequency */}
      <div className="space-y-1">
        <label
          htmlFor="med-frequency"
          className="block text-base font-medium text-gray-900"
        >
          Frequency
        </label>
        <select
          id="med-frequency"
          name="frequency"
          defaultValue={medication?.frequency ?? ''}
          className="w-full min-h-[48px] px-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          required
        >
          <option value="" disabled>
            Select frequency...
          </option>
          {FREQUENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {state?.errors?.frequency && (
          <p className="text-base text-red-600">
            {state.errors.frequency[0]}
          </p>
        )}
      </div>

      {/* Timing checkboxes */}
      <fieldset className="space-y-2">
        <legend className="text-base font-medium text-gray-900">
          Timing
        </legend>
        <div className="flex flex-wrap gap-2">
          {TIMING_PRESETS.map((preset) => {
            const isChecked = medication?.timing?.includes(preset.value);
            return (
              <label
                key={preset.value}
                className="flex items-center gap-2 min-h-[48px] px-3 py-2 border border-gray-300 rounded-lg cursor-pointer has-[:checked]:bg-blue-50 has-[:checked]:border-blue-500"
              >
                <input
                  type="checkbox"
                  name="timing"
                  value={preset.value}
                  defaultChecked={isChecked}
                  className="w-5 h-5 accent-blue-600"
                />
                <span className="text-base">{preset.label}</span>
              </label>
            );
          })}
        </div>
        {state?.errors?.timing && (
          <p className="text-base text-red-600">{state.errors.timing[0]}</p>
        )}
      </fieldset>

      {/* General error */}
      {state?.error && (
        <p className="text-base text-red-600">{state.error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full min-h-[48px] bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending
          ? 'Saving...'
          : mode === 'add'
            ? 'Add Medication'
            : 'Save Changes'}
      </button>
    </form>
  );
}
