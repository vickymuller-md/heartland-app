import { authorize } from '@/lib/auth/authorization';
import { getMonthlyReportData, getNiwTractionStats, getReportPatientIds, getReportPatients } from '@/lib/reports/queries';
import { reportDateBounds } from '@/lib/reports/date-range';
import { ReportsShell } from './_components/reports-shell';
import { NiwReportTrigger } from './_components/niw-report-trigger';
import { DateRangePicker } from './_components/date-range-picker';
import { redirect } from 'next/navigation';

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ from?: string; to?: string; patient?: string }>;
}) {
  const auth = await authorize('provider');
  if (!auth.authorized) {
    if (auth.error === 'Consent required') redirect('/consent');
    redirect(auth.error === 'MFA required' ? '/security/mfa' : '/login');
  }
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const range = { from: params.from ?? today.slice(0, 8) + '01', to: params.to ?? today };
  try { reportDateBounds(range); } catch {
    return <div className="space-y-4"><h1 className="text-2xl font-bold">Reports &amp; Data Export</h1>
      <p role="alert">Choose a valid UTC date range from the first through the last day. Select up to 367 calendar days.</p>
      <DateRangePicker {...range} /></div>;
  }
  const [panel, niw] = await Promise.allSettled([
    getReportPatientIds(auth.supabase, auth.user.id).then(ids => Promise.all([
      getMonthlyReportData(auth.supabase, auth.user.id, range, ids), getReportPatients(auth.supabase, ids),
    ] as const)),
    getNiwTractionStats(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Reports &amp; Data Export</h1>
      {panel.status === 'fulfilled' ? (
        <ReportsShell providerId={auth.user.id} data={panel.value[0]} patients={panel.value[1]} {...range} />
      ) : <div className="space-y-3"><DateRangePicker {...range} />
        <p role="alert">Panel data is unavailable. Reload to prepare an accurate export.</p></div>}
      <section className="mt-8 border-t pt-6">
        <h2 className="text-lg font-semibold mb-2">NIW Activity Report</h2>
        <p className="text-sm text-gray-600 mb-4">Registered account counts and recorded synthetic activity for dissemination evidence.</p>
        {niw.status === 'fulfilled' ? <NiwReportTrigger data={niw.value} />
          : <p role="alert">Platform activity data is unavailable. Reload to prepare the evidence report.</p>}
      </section>
    </div>
  );
}
