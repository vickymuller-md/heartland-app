'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pill, Loader2 } from 'lucide-react';
import { medicationFrequency, medicationTiming, summarizeAdherence, WEEKDAYS } from '@/lib/medications/schedule';
import { FREQUENCY_OPTIONS } from '@/lib/medications/constants';
import { createClient } from '@/lib/supabase/client';

interface Medication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  timing: string | null;
  active: boolean;
  weekly_day?: number | null;
  adherence_pct?: number;
}

interface MedicationSummaryProps {
  patientId: string;
  adherenceSummary?: unknown;
}

export function MedicationSummary(props: MedicationSummaryProps) {
  const days = Array.isArray(props.adherenceSummary) ? props.adherenceSummary : null;
  const summary = days?.length ? summarizeAdherence(days) : null;
  return <div className="space-y-4">
    <section aria-label="30-day medication record" className="rounded-lg border p-4">
      <h3 className="font-medium">30-day medication record</h3>
      {summary ? <>
        <p>{summary.scheduled ? `${summary.taken} of ${summary.scheduled} scheduled doses recorded on confirmed days.` :
          summary.uncertainDays ? 'No confirmed scheduled doses in the available days.' : 'No doses scheduled in this period.'}</p>
        {summary.uncertainDays > 0 && <p className="text-sm text-amber-900">{summary.uncertainDays} {summary.uncertainDays === 1 ? 'day has' : 'days have'} an unconfirmed schedule and {summary.uncertainDays === 1 ? 'is' : 'are'} excluded.</p>}
      </> : <p className="text-sm">The 30-day medication record is unavailable.</p>}
    </section>
    <PatientMedications key={props.patientId} {...props} />
  </div>;
}

function PatientMedications({ patientId, adherenceSummary }: MedicationSummaryProps) {
  const supplied = useMemo(
    () => adherenceSummary && typeof adherenceSummary === 'object' && 'medications' in adherenceSummary
      ? (adherenceSummary as { medications?: Medication[] }).medications ?? []
      : null,
    [adherenceSummary],
  );
  const [fetched, setMedications] = useState<Medication[]>([]);
  const medications = supplied ?? fetched;
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(supplied === null);

  useEffect(() => {
    let active = true;
    async function fetchMeds() {
      if (supplied !== null) return;
      try {
        const supabase = createClient();
        const { data, error: readError } = await supabase
          .from('medications')
          .select('id, name, dosage, frequency, timing, active, weekly_day')
          .eq('patient_id', patientId)
          .eq('active', true)
          .order('name');

        if (readError || !data) throw new Error('Medication list unavailable');
        if (active) { setMedications(data); setError(false); }
      } catch { if (active) setError(true); }
      finally {
        if (active) setLoading(false);
      }
    }
    void fetchMeds();
    return () => { active = false; };
  }, [patientId, supplied]);

  if (supplied === null && error) return <p role="alert">The medication list could not be loaded.</p>;
  if (supplied === null && loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (medications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Pill className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-600">No active medications listed</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="medication-summary">
      <p className="text-sm text-gray-500">
        {medications.length} active medication{medications.length !== 1 ? 's' : ''}
      </p>

      <div className="divide-y divide-gray-100 rounded-lg border bg-white">
        {medications.map((med) => (
          <div key={med.id} className="flex items-start justify-between p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
                <Pill className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">{med.name}</p>
                <p className="text-sm text-gray-500">
                  {med.dosage}
                  {' · ' + (FREQUENCY_OPTIONS.find(item => item.value === medicationFrequency(med.frequency))?.label ?? med.frequency ?? 'Frequency pending confirmation')}
                  {medicationFrequency(med.frequency) === 'weekly' && (' · ' + (med.weekly_day == null ? 'Weekday pending confirmation' : WEEKDAYS[med.weekly_day]))}
                </p>
                {med.timing && (
                  <p className="text-xs text-gray-600 mt-0.5">
                    {medicationTiming(med.timing).join(' / ')}
                  </p>
                )}
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {typeof med.adherence_pct === 'number' ? `${med.adherence_pct}%` : 'Active'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
