'use client';

/**
 * HEARTLAND Dose Log Grid -- Today's dose checkboxes
 *
 * Renders a checkbox per scheduled dose per active medication.
 * Checking a dose fires the logDose Server Action via form.
 * Uses optimistic UI with startTransition for instant feedback.
 *
 * Elderly-friendly: 48px tap targets, clear labels.
 */

import { useState, useTransition } from 'react';
import { format } from 'date-fns';
import { FREQUENCY_DOSES_MAP } from '@/lib/medications/constants';
import type { MedicationRow, MedicationLog } from '@/lib/medications/types';
import { logDose } from '@/lib/medications/actions';

interface DoseLogGridProps {
  medications: MedicationRow[];
  todayLogs: MedicationLog[];
}

export function DoseLogGrid({ medications, todayLogs }: DoseLogGridProps) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [optimisticLogs, setOptimisticLogs] = useState<
    Record<string, boolean>
  >({});
  const [isPending, startTransition] = useTransition();

  // Filter out as_needed medications (0 scheduled doses)
  const scheduledMeds = medications.filter(
    (med) => FREQUENCY_DOSES_MAP[med.frequency] > 0
  );

  if (scheduledMeds.length === 0) {
    return (
      <p className="text-base text-gray-500 py-4">
        No scheduled medications for today.
      </p>
    );
  }

  function isDoseTaken(medId: string, doseNum: number): boolean {
    const key = `${medId}-${doseNum}`;
    if (key in optimisticLogs) return optimisticLogs[key];
    return todayLogs.some(
      (log) =>
        log.medication_id === medId &&
        log.dose_number === doseNum &&
        log.taken === true
    );
  }

  function handleToggle(medId: string, doseNum: number, taken: boolean) {
    const key = `${medId}-${doseNum}`;
    // Optimistic update
    setOptimisticLogs((prev) => ({ ...prev, [key]: !taken }));

    startTransition(async () => {
      const formData = new FormData();
      formData.set('medication_id', medId);
      formData.set('scheduled_date', todayStr);
      formData.set('dose_number', String(doseNum));
      formData.set('taken', String(!taken));

      const result = await logDose(null, formData);
      if (result.error) {
        // Revert on error
        setOptimisticLogs((prev) => ({ ...prev, [key]: taken }));
      }
    });
  }

  return (
    <div className="space-y-4">
      {scheduledMeds.map((med) => {
        const doseCount = FREQUENCY_DOSES_MAP[med.frequency];
        const timingLabels = med.timing.length >= doseCount ? med.timing : null;

        return (
          <div key={med.id} className="space-y-2">
            <p className="text-lg font-semibold text-gray-900">{med.name}</p>
            <p className="text-sm text-gray-500">{med.dosage}</p>
            <div className="flex flex-wrap gap-3">
              {Array.from({ length: doseCount }).map((_, i) => {
                const doseNum = i + 1;
                const taken = isDoseTaken(med.id, doseNum);
                const label = timingLabels
                  ? timingLabels[i].charAt(0).toUpperCase() +
                    timingLabels[i].slice(1)
                  : `Dose ${doseNum}`;

                return (
                  <button
                    key={doseNum}
                    type="button"
                    onClick={() => handleToggle(med.id, doseNum, taken)}
                    className={`min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg border-2 text-base font-medium transition-colors ${
                      taken
                        ? 'bg-green-100 border-green-500 text-green-800'
                        : 'bg-white border-gray-300 text-gray-700'
                    }`}
                    aria-pressed={taken}
                    aria-label={`${med.name} ${label}: ${taken ? 'taken' : 'not taken'}`}
                  >
                    {taken ? '\u2713 ' : ''}{label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
