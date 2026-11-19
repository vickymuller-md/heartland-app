import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { METRIC_DEFINITIONS } from '@/lib/quality-metrics/constants';
import { getQualityMetrics, getMetricHistory } from '@/lib/quality-metrics/queries';
import type { QualityMetricRecord, MonthlyTrend } from '@/lib/quality-metrics/types';
import { MetricCard } from './_components/metric-card';
import { QUALITY_METRIC_LIMIT } from '@/lib/implementation/constants';

export default async function QualityMetricsPage({ searchParams }: { searchParams: Promise<{ example?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { example } = await searchParams;
  const facilityTier = example === '1' ? 1 : example === '2-3' ? 2 : null;
  const [latest, histories] = await Promise.allSettled([
    getQualityMetrics(supabase, user.id),
    Promise.all(METRIC_DEFINITIONS.map(async def => [def.key, await getMetricHistory(supabase, user.id, def.key, 6)] as const)),
  ]);
  const latestByKey = new Map<string, QualityMetricRecord>(latest.status === 'fulfilled'
    ? latest.value.map(record => [record.metric_key, record]) : []);
  const historyByKey = new Map<string, MonthlyTrend[]>(histories.status === 'fulfilled' ? histories.value : []);
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quality Metrics Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Inspect recorded process measures and historical service-planning examples.
        </p>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{QUALITY_METRIC_LIMIT}</p>
      </div>

      <nav aria-label="Historical planning example" className="flex flex-wrap items-center gap-3">
        <span>Compare with an example</span>
        {[['', 'No comparison'], ['1', 'Tier 1'], ['2-3', 'Tiers 2 and 3']].map(([value, label]) => (
          <Link key={value} href={value ? `/quality-metrics?example=${value}` : '/quality-metrics'}
            aria-current={(example ?? '') === value ? 'page' : undefined}
            className="rounded border px-3 py-2 text-sm text-slate-800 aria-[current=page]:bg-slate-800 aria-[current=page]:text-white">
            {label}
          </Link>
        ))}
      </nav>
      {(latest.status === 'rejected' || histories.status === 'rejected') && (
        <p role="alert">Quality metric records could not be loaded completely. Reload to view the dashboard.</p>
      )}
      {/* Metric Cards Grid */}
      {latest.status === 'fulfilled' && histories.status === 'fulfilled' && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {METRIC_DEFINITIONS.map((def) => (
          <MetricCard
            key={def.key}
            definition={def}
            latestRecord={latestByKey.get(def.key) ?? null}
            history={historyByKey.get(def.key) ?? []}
            facilityTier={facilityTier}
          />
        ))}
      </div>}

      {/* Disclaimer */}
      <p className="text-xs text-gray-400">
        The care team enters these measures manually.
      </p>
    </div>
  );
}
