'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMedicationTimeZone } from '@/lib/medications/actions';
import { CALENDAR_SOURCE_LABEL, type MedicationCalendar } from '@/lib/medications/calendar';

export function CalendarSetting({ actorId, calendar, zones }: { actorId: string; calendar: MedicationCalendar; zones: string[] }) {
  const [selection, setSelection] = useState(calendar.pending_zone ?? calendar.zone);
  const [request] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState('');
  const [saving, start] = useTransition();
  const router = useRouter();
  return <details className="rounded-lg border bg-white p-3">
    <summary className="min-h-11 cursor-pointer font-medium">Medication calendar time zone</summary>
    <p className="mb-2 text-sm">{CALENDAR_SOURCE_LABEL[calendar.source]} · {calendar.zone}</p>
    {calendar.pending_at && calendar.pending_zone ? <p role="status" className="text-sm">
      Your choice of {calendar.pending_zone} takes effect {new Intl.DateTimeFormat('en-US', { timeZone: calendar.pending_zone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(calendar.pending_at))} in that zone. Your current medication day stays {calendar.day} until then.
    </p> : <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      const data = new FormData();
      for (const [key, value] of Object.entries({ actor: actorId, request, revision: calendar.revision, zone: selection })) data.set(key, value);
      start(async () => {
        try {
          const result = await setMedicationTimeZone(data);
          if (result.success) { setStatus('Time zone choice saved.'); router.refresh(); }
          else setStatus(result.error ?? 'The time zone was not confirmed.');
        } catch { setStatus('Saving was not confirmed. Keep this choice open and try again.'); }
      });
    }}>
      <label className="block text-sm font-medium" htmlFor="medication-time-zone">Your time zone</label>
      <input id="medication-time-zone" className="block min-h-11 w-full rounded border px-2" list="medication-zone-options" autoComplete="off"
        required maxLength={100} value={selection} onChange={event => { setStatus(''); setSelection(event.target.value); }} />
      <datalist id="medication-zone-options">{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={() => {
          setSelection(Intl.DateTimeFormat().resolvedOptions().timeZone); setStatus('');
        }}>Use my device’s time zone</button>
        <button type="submit" disabled={saving} className="min-h-11 rounded bg-blue-700 px-3 text-sm font-medium text-white">{saving ? 'Saving…' : 'Save time zone'}</button>
      </div>
    </form>}
    <p role="status" className="text-sm">{status}</p>
  </details>;
}
