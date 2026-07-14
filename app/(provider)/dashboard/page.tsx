import { Suspense } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getLinkedPatients } from '@/lib/dashboard/queries';
import type { SortKey } from '@/lib/dashboard/types';
import { PatientList } from './_components/patient-list';
import { SortControls } from './_components/sort-controls';
import { MetricCards, MetricCardsSkeleton } from './_components/metric-cards';
import { RpmTracker } from './_components/rpm-tracker';
import { UrgentNowSection } from './_components/urgent-now-section';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { getDailyLoop } from '@/lib/daily-loop/queries';
import { DailyLoop } from './_components/daily-loop';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';

/**
 * Provider Dashboard -- Server Component
 *
 * Fetches linked patients with computed status and renders the sortable
 * patient list. Sort param from URL drives server-side sort via getLinkedPatients.
 *
 * Requirements: DASH-01 (patient list), DASH-02 (sort), DASH-04 (alert badges),
 * METR-01..05 (metric cards, RPM tracker)
 */

interface DashboardPageProps {
  searchParams: Promise<{ sort?: string }>;
}

const VALID_SORTS: SortKey[] = ['status', 'vitals_date', 'risk_tier'];

export default async function ProviderDashboard({
  searchParams,
}: DashboardPageProps) {
  const params = await searchParams;
  const sortParam = params?.sort as SortKey | undefined;
  const sortBy: SortKey = sortParam && VALID_SORTS.includes(sortParam)
    ? sortParam
    : 'status';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [dailyLoop, patientResult] = await Promise.all([
    getDailyLoop(supabase, user.id),
    getLinkedPatients(supabase, user.id, sortBy)
      .then((patients) => ({ patients, error: null as string | null }))
      .catch(() => ({
        patients: [],
        error: 'The patient panel could not be loaded. Do not interpret this as an empty panel.',
      })),
  ]);
  const patients = patientResult.patients;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Operational workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">Daily Loop</h1>
          <p className="mt-1 text-sm text-gray-600">Priority, action, owner, deadline, and outcome in one queue.</p>
        </div>
      </div>

      <ProductEventTracker eventName="daily_loop_view" area="provider_home" />

      {dailyLoop.error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          {dailyLoop.error}
        </div>
      ) : (
        <DailyLoop sections={dailyLoop.sections} metrics={dailyLoop.metrics} />
      )}

      <div className="border-t pt-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Patient panel</h2>
            <p className="text-sm text-slate-600">Panel context and program metrics. Daily work remains above.</p>
          </div>
          <SortControls currentSort={sortBy} />
        </div>
      </div>

      {/* Metric cards + RPM tracker (METR-01..05) */}
      <Suspense fallback={<MetricCardsSkeleton />}>
        <MetricCards providerId={user.id} />
      </Suspense>
      <Suspense fallback={<div className="h-32 animate-pulse bg-muted rounded-lg mb-6" />}>
        <RpmTracker providerId={user.id} />
      </Suspense>

      {/* Urgent Now triage section (EFFI-01) */}
      <UrgentNowSection patients={patients} />

      {patientResult.error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          {patientResult.error}
        </div>
      ) : patients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-lg text-gray-600 mb-2">No patients linked yet</p>
          <p className="text-sm text-gray-500 mb-6">
            Invite patients to connect with you using a unique invite code.
          </p>
          <Link
            href="/patients/manage"
            className="min-h-[48px] px-6 py-3 text-base font-semibold bg-blue-600 text-white rounded-lg inline-flex items-center hover:bg-blue-700 transition-colors"
          >
            Invite a Patient
          </Link>
        </div>
      ) : (
        <PatientList patients={patients} />
      )}

      {/* Risk Framework disclaimer -- risk_tier chips reference the HEARTLAND Framework */}
      <ProviderPageDisclaimer variant="framework" />
    </div>
  );
}
