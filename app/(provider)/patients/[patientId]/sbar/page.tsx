/**
 * SBAR Handoff Generator -- Route Page (Server Component)
 * Requirements: SBAR-02 (auto-populate from patient data)
 *
 * Fetches patient vitals, medications, labs, risk tier, track, facility tier
 * and passes pre-filled SBAR data to the client SbarEditor component.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPatientDetail } from '@/lib/dashboard/queries';
import { getPatientMedications } from '@/lib/medications/queries';
import { populateSbar } from '@/lib/sbar/populate';
import { SbarEditor } from './_components/sbar-editor';

interface SbarPageProps {
  params: Promise<{ patientId: string }>;
}

export default async function SbarPage({ params }: SbarPageProps) {
  const { patientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Security gate: verify provider-patient link
  const detail = await getPatientDetail(supabase, user.id, patientId);
  if (!detail) {
    redirect('/dashboard?error=patient_not_found');
  }

  // Parallel fetches for SBAR data
  const [meds, latestLabs, profileData] = await Promise.all([
    getPatientMedications(supabase, patientId),
    supabase
      .from('lab_results')
      .select(
        'collected_at,potassium,creatinine,egfr,bnp,nt_probnp,sodium'
      )
      .eq('patient_id', patientId)
      .order('collected_at', { ascending: false })
      .limit(3),
    supabase
      .from('patients')
      .select('risk_tier,track_assignment,facility_tier')
      .eq('id', patientId)
      .single(),
  ]);

  // Latest vitals (array is ascending by recorded_at, so last element is most recent)
  const latestVitals =
    detail.vitals.length > 0
      ? detail.vitals[detail.vitals.length - 1]
      : null;

  // Patient name from detail
  const patientName = detail.patient.full_name ?? 'Unknown';

  // Build SbarInput and populate
  const sbarData = populateSbar({
    patient_name: patientName,
    vitals: latestVitals
      ? {
          recorded_at: latestVitals.date,
          weight_lbs: latestVitals.weight_lbs,
          sbp: latestVitals.sbp,
          dbp: latestVitals.dbp,
          heart_rate: latestVitals.heart_rate,
          spo2: latestVitals.spo2 ?? null,
        }
      : null,
    medications: meds.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
    })),
    labs: (latestLabs.data ?? []).map((l) => ({
      collected_at: l.collected_at,
      potassium: l.potassium,
      creatinine: l.creatinine,
      egfr: l.egfr,
      bnp: l.bnp,
      nt_probnp: l.nt_probnp,
      sodium: l.sodium,
    })),
    risk_tier: profileData.data?.risk_tier ?? null,
    track_assignment: profileData.data?.track_assignment ?? null,
    facility_tier: profileData.data?.facility_tier ?? null,
  });

  return (
    <SbarEditor
      initialData={sbarData}
      patientName={patientName}
      patientId={patientId}
    />
  );
}
