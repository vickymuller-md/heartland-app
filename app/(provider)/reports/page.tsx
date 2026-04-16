/**
 * Reports & Data Export -- Server Component
 *
 * Reads searchParams for date range, fetches monthly report data
 * and linked patients list, passes to ReportsShell client component.
 * Also fetches platform-wide NIW traction stats for petition evidence.
 *
 * Requirements: REPT-01, REPT-02, REPT-03, REPT-04, REPT-05, REPT-06
 * Source: HEARTLAND Protocol v3.3 -- Phase 21, Phase 28
 */

import { createClient } from '@/lib/supabase/server';
import { getMonthlyReportData, getNiwTractionStats } from '@/lib/reports/queries';
import { getLinkedPatients } from '@/lib/dashboard/queries';
import { ReportsShell } from './_components/reports-shell';
import { NiwReportTrigger } from './_components/niw-report-trigger';
import { startOfMonth, format } from 'date-fns';
import { redirect } from 'next/navigation';

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; patient?: string }>;
}) {
  const params = await searchParams;

  const today = new Date();
  const from = params.from ?? format(startOfMonth(today), 'yyyy-MM-dd');
  const to = params.to ?? format(today, 'yyyy-MM-dd');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const providerId = user.id;

  const [monthlyData, linkedPatients, niwData] = await Promise.all([
    getMonthlyReportData(supabase, providerId, { from, to }),
    getLinkedPatients(supabase, providerId),
    getNiwTractionStats(),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports &amp; Data Export</h1>
      <ReportsShell
        data={monthlyData}
        patients={linkedPatients}
        from={from}
        to={to}
      />

      {/* NIW Traction Report Section */}
      <section className="mt-8 border-t pt-6">
        <h2 className="text-lg font-semibold mb-2">NIW Traction Report</h2>
        <p className="text-sm text-gray-600 mb-4">
          One-page PDF showing platform-wide adoption for NIW petition evidence.
        </p>
        <NiwReportTrigger data={niwData} />
      </section>
    </div>
  );
}
