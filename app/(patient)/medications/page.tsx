import { format } from 'date-fns';
import { Pill } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getPatientMedications, getTodayLogs, getAdherenceData } from '@/lib/medications/queries';
import { DoseLogGrid } from './_components/dose-log-grid';
import { AdherenceHeatmap } from './_components/adherence-heatmap';
import { MedicationList } from './_components/medication-list';

export default async function MedicationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Medications
        </h1>
        <p className="text-base text-gray-500">
          Please sign in to manage your medications.
        </p>
      </div>
    );
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const [medications, todayLogs, adherenceData] = await Promise.all([
    getPatientMedications(supabase, user.id),
    getTodayLogs(supabase, user.id, todayStr),
    getAdherenceData(supabase, user.id),
  ]);

  // Empty state
  if (medications.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Medications
        </h1>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Pill className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-lg text-gray-500 mb-6">
            No medications added yet. Tap the button below to add your first
            medication.
          </p>
          <MedicationList medications={[]} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Medications
      </h1>

      {/* Section 1: Today's Doses */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Today&apos;s Doses
        </h2>
        <DoseLogGrid medications={medications} todayLogs={todayLogs} />
      </section>

      {/* Section 2: 30-Day Adherence */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          30-Day Adherence
        </h2>
        <AdherenceHeatmap data={adherenceData} />
      </section>

      {/* Section 3: Your Medications */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Your Medications
        </h2>
        <MedicationList medications={medications} />
      </section>
    </div>
  );
}
