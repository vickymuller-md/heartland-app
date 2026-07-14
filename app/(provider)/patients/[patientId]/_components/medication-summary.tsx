'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pill, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Medication {
  id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  timing: string | null;
  active: boolean;
  adherence_pct?: number;
}

interface MedicationSummaryProps {
  patientId: string;
  adherenceSummary?: unknown;
}

export function MedicationSummary({ patientId, adherenceSummary }: MedicationSummaryProps) {
  const supplied = useMemo(
    () => adherenceSummary && typeof adherenceSummary === 'object' && 'medications' in adherenceSummary
      ? (adherenceSummary as { medications?: Medication[] }).medications ?? []
      : null,
    [adherenceSummary],
  );
  const [medications, setMedications] = useState<Medication[]>(supplied ?? []);
  const [loading, setLoading] = useState(supplied === null);

  useEffect(() => {
    async function fetchMeds() {
      if (supplied !== null) return;
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('medications')
          .select('id, name, dosage, frequency, timing, active')
          .eq('patient_id', patientId)
          .eq('active', true)
          .order('name');

        setMedications(data ?? []);
      } finally {
        setLoading(false);
      }
    }
    void fetchMeds();
  }, [patientId, supplied]);

  if (loading) {
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
        <p className="text-gray-600">No medications recorded</p>
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
                  {med.frequency ? ` — ${med.frequency}` : ''}
                </p>
                {med.timing && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {med.timing.split(',').join(' / ')}
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
