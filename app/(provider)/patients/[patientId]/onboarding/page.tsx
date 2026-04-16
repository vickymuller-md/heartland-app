import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSetupStatus } from '@/lib/onboarding/queries';
import { OnboardingWizard } from './onboarding-wizard';

/**
 * Onboarding Wizard Route -- Server Component
 * Requirements: ONBD-01, ONBD-02
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * Auth check, fetch patient name + setup status, render wizard shell.
 */

interface OnboardingPageProps {
  params: Promise<{ patientId: string }>;
}

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { patientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Verify caller is a provider
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'provider') redirect('/today');

  // Fetch patient name (scoped by provider link)
  const { data: linkData } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', user.id)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();

  if (!linkData) redirect('/dashboard?error=patient_not_found');

  const { data: patientProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', patientId)
    .single();

  const patientName = patientProfile?.full_name ?? 'Unknown Patient';

  // Fetch current setup progress
  const completedSteps = await getSetupStatus(supabase, patientId);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/patients/${patientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Patient
      </Link>

      {/* Page heading */}
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Patient Setup: {patientName}
      </h1>

      {/* Wizard */}
      <OnboardingWizard
        patientId={patientId}
        patientName={patientName}
        completedSteps={completedSteps}
      />
    </div>
  );
}
