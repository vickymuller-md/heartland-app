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
import { getEffectiveLabObservations } from '@/lib/labs/effective';
import { SbarEditor } from './_components/sbar-editor';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';

interface SbarPageProps {
  params: Promise<{ patientId: string }>;
}

export default async function SbarPage({ params }: SbarPageProps) {
  const { patientId } = await params;
  const supabase = await createClient();
  const {
    data: { user }, error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect('/login');
  // Fixed start of this read, not a refreshed timestamp when the draft is edited/printed.
  const sourceReadAt = new Date().toISOString();

  // Security gate: verify provider-patient link
  const detail = await getPatientDetail(supabase, user.id, patientId);
  if (!detail) {
    redirect('/dashboard?error=patient_not_found');
  }

  try {
    const [meds, effectiveLabs, profileData] = await Promise.all([
      getPatientMedications(supabase, patientId),
      getEffectiveLabObservations(supabase, [patientId], user.id),
      supabase
        .from('patients')
        .select('risk_tier,track_assignment,facility_tier')
        .eq('id', patientId)
        .single(),
    ]);
    if (profileData.error || !profileData.data) throw new Error('SBAR source profile unavailable');

    // Latest vitals (array is ascending by recorded_at, so last element is most recent)
    const latestVitals =
      detail.vitals.length > 0
        ? detail.vitals[detail.vitals.length - 1]
        : null;

    // Patient name from detail
    const patientName = detail.patient.full_name ?? 'Unknown';

    // Build SbarInput and populate
    const sbarData = populateSbar({
      patient_id: patientId,
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
      labs: effectiveLabs,
      risk_tier: profileData.data?.risk_tier ?? null,
      track_assignment: profileData.data?.track_assignment ?? null,
      facility_tier: profileData.data?.facility_tier ?? null,
    }, new Date()); // Assess timestamps after the complete read, not against its earlier start.

    return (
      <div className="space-y-4">
        {profileData.data?.risk_tier && (
          <ProviderPageDisclaimer variant="framework" />
        )}
        <SbarEditor
          providerId={user.id}
          sourceReadAt={sourceReadAt}
          initialData={sbarData}
          patientName={patientName}
          patientId={patientId}
        />
      </div>
    );
  } catch {
    return <p role="alert">SBAR draft unavailable: source data could not be verified. Reload the page; no draft was generated.</p>;
  }
}
