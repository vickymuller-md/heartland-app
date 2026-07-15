import { Suspense } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MetricCards, MetricCardsSkeleton } from './_components/metric-cards';
import { RpmTracker } from './_components/rpm-tracker';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { getDailyLoop, getSavedQueueViews } from '@/lib/daily-loop/queries';
import { DailyLoop } from './_components/daily-loop';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';
import { getTeamDirectory } from '@/lib/team/queries';
import { QueueViewControls } from './_components/queue-view-controls';
import type { DailyLoopFilter, WorkPriority, WorkSeverity } from '@/lib/daily-loop/types';

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
  searchParams: Promise<{
    view?: string;
    severity?: string;
    priority?: string;
    sourceType?: string;
    page?: string;
  }>;
}

const VALID_SEVERITIES: WorkSeverity[] = ['critical', 'warning', 'informational'];
const VALID_PRIORITIES: WorkPriority[] = ['now', 'today', 'week', 'watching'];
const VALID_SOURCE_TYPES = [
  'alert', 'scheduled_followup', 'discharge_followup', 'manual',
  'titration', 'data_quality',
] as const;
const PAGE_SIZE = 20;

export default async function ProviderDashboard({
  searchParams,
}: DashboardPageProps) {
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [savedViews, teamDirectory] = await Promise.all([
    getSavedQueueViews(supabase, user.id),
    getTeamDirectory(supabase),
  ]);
  const selectedView = savedViews.views.find((view) => view.id === params.view);
  const directFilter: DailyLoopFilter = {
    severity: VALID_SEVERITIES.includes(params.severity as WorkSeverity)
      ? params.severity as WorkSeverity
      : undefined,
    priority: VALID_PRIORITIES.includes(params.priority as WorkPriority)
      ? params.priority as WorkPriority
      : undefined,
    sourceType: VALID_SOURCE_TYPES.includes(params.sourceType as typeof VALID_SOURCE_TYPES[number])
      ? params.sourceType
      : undefined,
  };
  const hasDirectFilter = Boolean(directFilter.severity || directFilter.priority || directFilter.sourceType);
  const activeFilter: DailyLoopFilter = hasDirectFilter
    ? directFilter
    : selectedView ? {
      severity: selectedView.severity ?? undefined,
      priority: selectedView.priority ?? undefined,
      sourceType: selectedView.source_type ?? undefined,
    } : {};
  const dailyLoop = await getDailyLoop(
    supabase,
    user.id,
    activeFilter,
    { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
  );
  const queueParams = new URLSearchParams();
  if (selectedView && !hasDirectFilter) queueParams.set('view', selectedView.id);
  if (activeFilter.severity) queueParams.set('severity', activeFilter.severity);
  if (activeFilter.priority) queueParams.set('priority', activeFilter.priority);
  if (activeFilter.sourceType) queueParams.set('sourceType', activeFilter.sourceType);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Operational workspace</p>
          <h1 className="text-3xl font-bold tracking-tight text-gray-950">Daily Loop</h1>
          <p className="mt-1 text-sm text-gray-600">Priority, action, owner, deadline, and outcome in one queue.</p>
        </div>
      </div>

      <ProductEventTracker eventName="daily_loop_view" area="provider_home" trackDuration />

      {savedViews.error ? (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{savedViews.error}</div>
      ) : (
        <QueueViewControls
          views={savedViews.views}
          selectedViewId={selectedView?.id}
          currentFilter={activeFilter}
        />
      )}

      {teamDirectory.error && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{teamDirectory.error} Delegation is unavailable.</div>
      )}

      {dailyLoop.error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          {dailyLoop.error}
        </div>
      ) : (
        <DailyLoop
          sections={dailyLoop.sections}
          metrics={dailyLoop.metrics}
          pagination={dailyLoop.pagination}
          page={page}
          queryString={queueParams.toString()}
          timeZone={dailyLoop.timeZone}
          teamMembers={teamDirectory.members}
          manageableOrganizationIds={teamDirectory.manageableOrganizationIds}
        />
      )}

      <details className="rounded-2xl border bg-white p-5">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-bold text-slate-950">
          <Users className="size-5 text-blue-700" aria-hidden="true" /> Program context and patient metrics
        </summary>
        <div className="mt-5 space-y-5 border-t pt-5">
          <div className="flex justify-end">
            <Link href="/patients" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold text-blue-700">Open patient directory</Link>
          </div>
          <Suspense fallback={<MetricCardsSkeleton />}>
            <MetricCards providerId={user.id} />
          </Suspense>
          <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
            <RpmTracker providerId={user.id} />
          </Suspense>
        </div>
      </details>

      {/* Risk Framework disclaimer -- risk_tier chips reference the HEARTLAND Framework */}
      <ProviderPageDisclaimer variant="framework" />
    </div>
  );
}
