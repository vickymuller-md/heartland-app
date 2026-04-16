/**
 * Track B: Printable Diary Page (Server Component)
 * Requirement: TRKB-01
 *
 * Renders a screen preview of the 7-day diary + red flag card with a
 * print button. The print layout hides screen chrome and renders the
 * diary and red flag card on consecutive pages.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PrintButton } from '@/components/ui/print-button';
import TrackBDiary from '@/lib/vitals/track-b-diary';
import RedFlagCard from '@/lib/vitals/red-flag-card';

interface TrackBDiaryPageProps {
  params: Promise<{ patientId: string }>;
}

export default async function TrackBDiaryPage({ params }: TrackBDiaryPageProps) {
  const { patientId } = await params;
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
    <>
      {/* Screen preview */}
      <div className="print:hidden space-y-6">
        <Link
          href={`/patients/${patientId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Patient
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Track B Monitoring Diary
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {patientName} &mdash; Print this diary for the patient to fill out at home.
            </p>
          </div>
          <PrintButton label="Print Diary" />
        </div>

        <div className="rounded-lg border bg-white p-6 space-y-8">
          <TrackBDiary patientName={patientName} />
          <hr className="border-gray-200" />
          <RedFlagCard />
        </div>
      </div>

      {/* Print layout: diary on page 1, red flag card on page 2 */}
      <div className="hidden print:block">
        <TrackBDiary patientName={patientName} />
        <div style={{ breakBefore: 'page' }}>
          <RedFlagCard />
        </div>
      </div>
    </>
  );
}
