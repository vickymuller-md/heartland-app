import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { ComorbidityKey } from '@/lib/comorbidity/types';
import { ComorbidityManagerClient } from './comorbidity-manager-client';

export const metadata: Metadata = {
  title: 'Comorbidity Manager | HEARTLAND Protocol',
  description:
    'Assess comorbidity impact on GDMT, evaluate advanced HF referral and device criteria, and save comorbidity profiles.',
};

interface ComorbidityManagerPageProps {
  searchParams: Promise<{ patientId?: string }>;
}

export default async function ComorbidityManagerPage({
  searchParams,
}: ComorbidityManagerPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch linked patients (same pattern as patient directory)
  const { data: links } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', user.id)
    .eq('status', 'active');

  const patientIds = links?.map((l) => l.patient_id) ?? [];

  let patients: { id: string; full_name: string }[] = [];
  if (patientIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', patientIds);

    patients = (profiles ?? [])
      .map((p) => ({ id: p.id, full_name: p.full_name ?? 'Unknown' }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  // If patientId selected, fetch current comorbidities
  const { patientId } = await searchParams;
  let initialComorbidities: ComorbidityKey[] = [];

  if (patientId) {
    const { data } = await supabase
      .from('patients')
      .select('comorbidities')
      .eq('id', patientId)
      .single();

    initialComorbidities = ((data?.comorbidities ?? []) as ComorbidityKey[]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Comorbidity Manager
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Select comorbidities, review GDMT guidance, and evaluate advanced HF
          criteria. Based on HEARTLAND Protocol Module 6.
        </p>
      </div>

      {/* Disclaimer banner */}
      <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
        This tool is designed for healthcare professionals as an educational implementation-support resource. It does not provide medical diagnoses, treatment
        recommendations for individual patients, or replace clinical judgment.
        Not intended for direct patient care. For professional use only.
      </div>

      <ComorbidityManagerClient
        patients={patients}
        selectedPatientId={patientId ?? null}
        initialComorbidities={initialComorbidities}
      />
    </div>
  );
}
