/**
 * Track B: Provider Data Entry Page (Server Component)
 * Requirements: TRKB-02, TRKB-06
 *
 * Allows providers to enter diary vitals for Track B (Analog) patients.
 * Supports two modes:
 *   - ?mode=single (default): Single-day entry via ProviderVitalsForm
 *   - ?mode=batch: 7-day batch entry via BatchEntryGrid
 *
 * Verifies provider-patient link before rendering the form.
 * Pattern follows track-b-diary page (same auth + link check).
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import ProviderVitalsForm from './_components/provider-vitals-form';
import BatchEntryGrid from './_components/batch-entry-grid';

interface TrackBEntryPageProps {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ mode?: string }>;
}

export default async function TrackBEntryPage({ params, searchParams }: TrackBEntryPageProps) {
  const { patientId } = await params;
  const { mode } = await searchParams;
  const isBatch = mode === 'batch';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Verify provider-patient link
  const { data: link } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', user.id)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();

  if (!link) {
    redirect('/patients');
  }

  // Fetch patient name
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', patientId)
    .single();

  const patientName = profile?.full_name ?? 'Unknown';

  return (
    <div className="space-y-6">
      <Link
        href={`/patients/${patientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Patient
      </Link>

      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Enter Diary Data for {patientName}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              <FileText className="h-3 w-3" aria-hidden="true" />
              Track B (Analog)
            </span>
            <Link
              href={`/patients/${patientId}`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              View Patient Details
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-6">
        {/* Mode toggle */}
        <div className="flex gap-2 mb-6">
          <Link
            href={`/patients/${patientId}/track-b-entry?mode=single`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !isBatch
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Single Entry
          </Link>
          <Link
            href={`/patients/${patientId}/track-b-entry?mode=batch`}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isBatch
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Batch Entry
          </Link>
        </div>

        {/* Conditional form rendering */}
        {isBatch ? (
          <BatchEntryGrid patientId={patientId} />
        ) : (
          <ProviderVitalsForm patientId={patientId} />
        )}
      </div>
    </div>
  );
}
