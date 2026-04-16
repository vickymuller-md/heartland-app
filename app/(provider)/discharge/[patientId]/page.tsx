/**
 * Discharge Checklist -- Route Page (Server Component)
 * Requirements: DSCH-01 through DSCH-06
 *
 * Fetches patient data, discharge record, and follow-ups.
 * Renders bundle checklist, task-shifting table, contact scheduler,
 * and printable instructions.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4
 */

import { redirect } from 'next/navigation';
import { ArrowLeft, ClipboardList, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getDischargeRecord, getDischargeFollowups } from '@/lib/discharge/queries';
import { DischargeBundleChecklist } from './_components/DischargeBundleChecklist';
import { TaskShiftingTable } from './_components/TaskShiftingTable';
import { ContactScheduler } from './_components/ContactScheduler';
import { PrintableInstructions } from './_components/PrintableInstructions';

interface DischargePageProps {
  params: Promise<{ patientId: string }>;
}

export default async function DischargePage({ params }: DischargePageProps) {
  const { patientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch patient data
  const { data: patient, error: patientErr } = await supabase
    .from('patients')
    .select('id, full_name, risk_tier, track_assignment, facility_tier')
    .eq('id', patientId)
    .single();

  if (patientErr || !patient) {
    redirect('/dashboard?error=patient_not_found');
  }

  // Fetch provider profile for print header
  const { data: providerProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single();

  const providerName = providerProfile?.full_name ?? 'Provider';

  // Determine facility tier (default to 1 if not set -- Research Pitfall 1)
  const facilityTier = (patient.facility_tier ?? 1) as 1 | 2 | 3;
  const tierDefaulted = patient.facility_tier == null;

  // Fetch discharge record (may be null for first discharge)
  const record = await getDischargeRecord(supabase, patientId);

  // Fetch follow-ups if record exists
  const followups = record
    ? await getDischargeFollowups(supabase, record.id)
    : [];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/patients/${patientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Patient
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 print:hidden">
        <ClipboardList className="h-6 w-6 text-slate-700" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Discharge Checklist
          </h1>
          <p className="text-sm text-gray-500">
            {patient.full_name}
          </p>
        </div>
      </div>

      {/* Tier default notice */}
      {tierDefaulted && (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 print:hidden"
          role="status"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800">
            No facility tier assigned. Using Tier 1 (Minimal) defaults. Set tier in patient settings for accurate recommendations.
          </p>
        </div>
      )}

      {/* Bundle Checklist (DSCH-01) */}
      <DischargeBundleChecklist
        tier={facilityTier}
        initialChecked={record?.bundle_completed}
      />

      {/* Task-Shifting Framework (DSCH-02) */}
      <TaskShiftingTable />

      {/* Contact Scheduler + Form (DSCH-03, DSCH-04, DSCH-05) */}
      <ContactScheduler
        patientId={patientId}
        facilityTier={facilityTier}
        followups={followups}
        hasRecord={!!record}
      />

      {/* Printable Instructions (DSCH-06) */}
      <PrintableInstructions
        patientName={patient.full_name}
        dischargedAt={record?.discharged_at ?? new Date().toISOString()}
        facilityTier={facilityTier}
        providerName={providerName}
      />
    </div>
  );
}
