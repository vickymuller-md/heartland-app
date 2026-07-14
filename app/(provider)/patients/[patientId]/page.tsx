import Link from 'next/link';
import { ArrowLeft, AlertTriangle, FileText } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPatientDetail } from '@/lib/dashboard/queries';
import { getPatientMessages } from '@/lib/messages/queries';
import { getSetupStatus } from '@/lib/onboarding/queries';
import { ALL_STEPS_COMPLETE } from '@/lib/onboarding/constants';
import { Badge } from '@/components/ui/badge';
import { PatientDetailTabs } from './_components/patient-detail-tabs';
import { SetupPrompt } from './_components/setup-prompt';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { getPatientOperationalView } from '@/lib/patient/operational';
import { PatientBrief } from './_components/patient-brief';
import { PatientTimeline } from './_components/patient-timeline';
import { ActionCenter } from './_components/action-center';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';

/**
 * Patient Detail -- Server Component
 *
 * Fetches full patient data (vitals, symptoms, meds, education, notes, alerts)
 * and renders header with risk tier/track assignment plus the 5-tab detail view.
 *
 * Requirement: DASH-03 (patient detail view)
 */

interface PatientDetailPageProps {
  params: Promise<{ patientId: string }>;
}

/** Risk tier display labels and colors */
const TIER_DISPLAY: Record<string, { label: string; className: string }> = {
  low: { label: 'Low Risk', className: 'bg-green-100 text-green-700' },
  moderate: { label: 'Moderate Risk', className: 'bg-amber-100 text-amber-700' },
  high: { label: 'High Risk', className: 'bg-red-100 text-red-700' },
  very_high: { label: 'Very High Risk', className: 'bg-red-200 text-red-800' },
};

/** Track display */
const TRACK_DISPLAY: Record<string, string> = {
  track_a: 'Digital Track',
  track_b: 'Analog Track',
};

export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { patientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const detail = await getPatientDetail(supabase, user.id, patientId);

  if (!detail) {
    redirect('/dashboard?error=patient_not_found');
  }

  const { patient, vitals, symptoms, adherenceSummary, educationProgress, notes, openAlerts } = detail;
  const messages = await getPatientMessages(supabase, patientId);
  const operationalView = await getPatientOperationalView(supabase, user.id, patientId);
  const tierStyle = patient.risk_tier ? TIER_DISPLAY[patient.risk_tier] : null;
  const trackLabel = patient.track_assignment ? TRACK_DISPLAY[patient.track_assignment] : null;

  // Fetch contact info for Info tab
  const { data: profileData } = await supabase
    .from('profiles')
    .select('full_name, email, phone, address, patient_code')
    .eq('id', patientId)
    .single();

  const { data: clinicalData } = await supabase
    .from('patients')
    .select('risk_tier, track_assignment, facility_tier, comorbidities, ckm_stage')
    .eq('id', patientId)
    .single();

  const { data: linkData } = await supabase
    .from('provider_patient_links')
    .select('linked_at')
    .eq('provider_id', user.id)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();

  // Fetch onboarding setup status
  const completedSteps = await getSetupStatus(supabase, patientId);
  const setupComplete = completedSteps === ALL_STEPS_COMPLETE;

  const patientInfo = {
    patient_id: patientId,
    full_name: profileData?.full_name ?? patient.full_name,
    email: profileData?.email ?? null,
    phone: profileData?.phone ?? null,
    address: profileData?.address ?? null,
    patient_code: profileData?.patient_code ?? null,
    risk_tier: clinicalData?.risk_tier ?? patient.risk_tier,
    track_assignment: clinicalData?.track_assignment ?? patient.track_assignment,
    facility_tier: clinicalData?.facility_tier ?? null,
    linked_at: linkData?.linked_at ?? null,
    ckm_stage: clinicalData?.ckm_stage ?? null,
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Patient header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {patient.full_name}
          </h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {tierStyle && (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tierStyle.className}`}
                data-testid="risk-tier-badge"
              >
                {tierStyle.label}
              </span>
            )}
            {trackLabel && (
              <span
                className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                data-testid="track-badge"
              >
                {trackLabel}
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/patients/${patientId}/sbar`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors print:hidden"
        >
          <FileText className="h-4 w-4" />
          Generate Handoff
        </Link>
      </div>

      {/* Alert banner */}
      {openAlerts.length > 0 && (
        <div
          className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
          role="alert"
        >
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <p className="text-sm font-medium text-red-800">
            {openAlerts.length} open alert{openAlerts.length !== 1 ? 's' : ''} requiring attention
          </p>
        </div>
      )}

      {/* Setup prompt */}
      <SetupPrompt patientId={patientId} setupComplete={setupComplete} />

      <ProductEventTracker eventName="patient_brief_view" area="patient_workspace" />
      {operationalView.error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          {operationalView.error}
        </div>
      )}
      <PatientBrief brief={operationalView.brief} />
      <ActionCenter patientId={patientId} />
      <PatientTimeline events={operationalView.timeline} />

      {/* Tabs */}
      <div id="patient-record-tabs" className="scroll-mt-4">
        <PatientDetailTabs
          patientId={patientId}
          vitals={vitals}
          symptoms={symptoms}
          adherenceSummary={adherenceSummary}
          educationProgress={educationProgress}
          notes={notes}
          messages={messages}
          openAlerts={openAlerts}
          comorbidities={(clinicalData?.comorbidities ?? []) as string[]}
          patientInfo={patientInfo}
        />
      </div>

      {/* Risk Framework disclaimer -- header shows risk_tier badge */}
      {patient.risk_tier && <ProviderPageDisclaimer variant="framework" />}
    </div>
  );
}
