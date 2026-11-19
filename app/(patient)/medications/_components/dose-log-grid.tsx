'use client';

import { useState } from 'react';
import { expectedDoseCount, medicationTiming, type MedicationSchedule } from '@/lib/medications/schedule';
import { TIMING_PRESETS } from '@/lib/medications/constants';
import type { MedicationLog } from '@/lib/medications/types';
import { logDose } from '@/lib/medications/actions';

interface DoseLogGridProps {
  schedules: MedicationSchedule[];
  todayLogs: MedicationLog[];
  today: string;
  actorId: string;
  calendarRevision: string;
}

export function DoseLogGrid({ schedules, todayLogs, today, actorId, calendarRevision }: DoseLogGridProps) {
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const eligible = schedules.filter(version => version.active || !version.known || version.active === null);

  async function record(version: MedicationSchedule, slot: number, taken: boolean) {
    const key = version.id + '/' + slot;
    setPending(key);
    setMessage('');
    const form = new FormData();
    for (const [field, value] of Object.entries({
      actor_id: actorId, medication_id: version.medication_id, version: version.id, scheduled_date: today, calendar_revision: calendarRevision,
      dose_number: String(slot), taken: String(taken),
    })) form.set(field, value);
    try {
      const result = await logDose(null, form);
      if (!result.success) { setMessage(result.error ?? 'Dose recording was not confirmed. Try again.'); return; }
      setSaved(previous => ({ ...previous, [key]: taken }));
      setMessage(taken ? 'Dose marked as taken.' : 'Dose mark removed.');
    } catch {
      setMessage('Dose recording was not confirmed. Reload the schedule before trying again.');
    } finally {
      setPending(null);
    }
  }

  return <div className="space-y-4">
    {!eligible.some(item => expectedDoseCount(item, today) !== 0) && <p>No scheduled medications for today.</p>}
    {eligible.map(version => {
      const count = expectedDoseCount(version, today);
      if (count === 0) return null;
      const labels = medicationTiming(version.timing);
      const timed = labels.length === count && labels.every(label => TIMING_PRESETS.some(preset => preset.value === label));
      return <div key={version.id} className="space-y-2 rounded-lg border p-3">
        <p className="text-lg font-semibold text-gray-900">{version.name ?? 'Medication record'}</p>
        <p className="text-sm text-gray-700">{version.dosage}</p>
        {!timed && labels.length > 0 && <p className="text-sm text-gray-700">Recorded timing: {labels.join(' · ')}</p>}
        {count === null ? <p className="text-sm text-amber-900">Schedule pending confirmation. Check the recorded instructions with your care team.</p> : <>
          {!timed && <p className="text-sm text-gray-700">Time pending confirmation. Follow your recorded instructions.</p>}
          <div className="flex flex-wrap gap-3">{Array.from({ length: count }, (_, index) => {
            const slot = index + 1, key = version.id + '/' + slot;
            const taken = saved[key] ?? todayLogs.some(log => log.medication_id === version.medication_id && log.dose_number === slot && log.taken);
            const label = timed ? TIMING_PRESETS.find(preset => preset.value === labels[index])!.label : 'Dose ' + slot;
            return <button key={slot} type="button" disabled={pending !== null} aria-pressed={taken}
              aria-label={version.name + ' ' + label + (taken ? ', taken' : ', not recorded')}
              className={`min-h-12 min-w-12 rounded-lg border-2 px-4 py-2 font-medium ${taken ? 'border-green-700 bg-green-100 text-green-900' : 'border-gray-400 bg-white text-gray-800'}`}
              onClick={() => void record(version, slot, !taken)}>{pending === key ? 'Saving…' : (taken ? 'Taken · ' : '') + label}</button>;
          })}</div>
        </>}
      </div>;
    })}
    <p role="status" className="text-sm text-gray-800">{message}</p>
  </div>;
}
