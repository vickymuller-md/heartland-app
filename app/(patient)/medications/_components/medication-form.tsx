'use client';

/**
 * HEARTLAND Medication Form -- Add/Edit medication
 *
 * Uses useActionState for Server Action integration.
 * Elderly-friendly: 48px tap targets, 16px+ fonts, clear labels.
 */

import { startTransition, useActionState, useEffect, useState } from 'react';
import { addMedication, updateMedication } from '@/lib/medications/actions';
import { FREQUENCY_OPTIONS, TIMING_PRESETS } from '@/lib/medications/constants';
import { medicationFrequency, WEEKDAYS } from '@/lib/medications/schedule';
import type { MedicationRow, MedicationActionState } from '@/lib/medications/types';

interface MedicationFormProps {
  mode: 'add' | 'edit';
  actorId: string;
  medication?: MedicationRow;
  onSuccess?: () => void;
}

export function MedicationForm({
  mode, actorId,
  medication,
  onSuccess,
}: MedicationFormProps) {
  const originalFrequency = medication?.frequency ?? '';
  const [frequency, setFrequency] = useState(medicationFrequency(originalFrequency) ??
    (originalFrequency === 'as directed' ? 'as_directed' : originalFrequency ? 'other' : ''));
  const [requestId] = useState(() => crypto.randomUUID());
  const instructions = medication?.timing.filter(value => !TIMING_PRESETS.some(preset => preset.value === value)).join(', ') ?? '';
  const action = mode === 'add' ? addMedication : updateMedication;
  const [state, formAction, isPending] = useActionState<
    MedicationActionState | null,
    FormData
  >(async (previous, data) => {
    try {
      return await action(previous, data);
    } catch {
      return { error: 'Saving was not confirmed. Keep this form open and try again.' };
    }
  }, null);

  // Close dialog on success
  useEffect(() => {
    if (state?.success && onSuccess) {
      onSuccess();
    }
  }, [state?.success, onSuccess]);

  return (
    <form onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      // Keep the recorded fields available when the acknowledgement is lost.
      startTransition(() => formAction(data));
    }} className="space-y-4">
      <input type="hidden" name="actor_id" value={actorId} />
      <input type="hidden" name="request_id" value={requestId} />
      {mode === 'edit' && <input type="hidden" name="revision" value={medication?.schedule_revision ?? ''} />}
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
          value={frequency}
          onChange={event => setFrequency(event.target.value)}
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
          <option value="as_directed">As directed · schedule pending confirmation</option>
          <option value="other">Other recorded instruction</option>
        </select>
        {frequency === 'other' && <label className="block text-sm">Frequency as written
          <input className="block min-h-12 w-full rounded border px-3" name="frequency_instruction" defaultValue={medicationFrequency(originalFrequency) ? '' : originalFrequency} required />
          {state?.errors?.frequency_instruction?.[0]}
        </label>}
        {frequency === 'weekly' && <label className="block text-base font-medium" htmlFor="weekly-day">Confirmed weekday
          <select id="weekly-day" name="weekly_day" defaultValue={medication?.weekly_day ?? ''} required className="block min-h-12 w-full rounded border px-3">
            <option value="" disabled>Choose the weekday in your instructions</option>
            {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select>
          {state?.errors?.weekly_day?.[0]}
        </label>}
        {state?.errors?.frequency && (
          <p className="text-base text-red-600">
            {state.errors.frequency[0]}
          </p>
        )}
      </div>

      {/* Timing checkboxes */}
      <fieldset className="space-y-2">
        <legend className="text-base font-medium text-gray-900">
          Timing (when known)
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
        <label htmlFor="med-timing-instruction" className="block text-sm">Other timing instructions as recorded</label>
        <input id="med-timing-instruction" name="timing_instruction" maxLength={500} defaultValue={instructions}
          className="min-h-12 w-full rounded border px-3" />
        {state?.errors?.timing && (
          <p className="text-base text-red-600">{state.errors.timing[0]}</p>
        )}
      </fieldset>

      {/* General error */}
      {state?.error && (
        <p role="alert" className="text-base text-red-600">{state.error}</p>
      )}

      <p className="text-sm text-gray-700">Changes apply to your care-team calendar day. If a dose was already recorded today, the updated schedule starts tomorrow.</p>
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
