/**
 * Quality Metrics Dashboard -- Server Component
 *
 * Fetches facility tier, latest records, and 6-month history for each metric.
 * Renders a responsive grid of 5 MetricCards.
 * Source: HEARTLAND Protocol v3.3 Module 8, Section 8.1
 */

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { METRIC_DEFINITIONS } from '@/lib/quality-metrics/constants';
import { getQualityMetrics, getMetricHistory } from '@/lib/quality-metrics/queries';
import type { QualityMetricRecord, MonthlyTrend } from '@/lib/quality-metrics/types';
import { MetricCard } from './_components/metric-card';

export default async function QualityMetricsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch facility tier from provider's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('facility_tier')
    .eq('id', user.id)
    .maybeSingle();

  const facilityTier: number | null = profile?.facility_tier ?? null;

  // Fetch latest records per metric
  const latestRecords = await getQualityMetrics(supabase, user.id);

  // Build a map for quick lookup
  const latestByKey = new Map<string, QualityMetricRecord>();
  for (const rec of latestRecords) {
    latestByKey.set(rec.metric_key, rec);
  }

  // Fetch 6-month history for each metric
  const historyByKey = new Map<string, MonthlyTrend[]>();
  for (const def of METRIC_DEFINITIONS) {
    const history = await getMetricHistory(supabase, user.id, def.key, 6);
    historyByKey.set(def.key, history);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quality Metrics Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Track your facility&apos;s performance against HEARTLAND Protocol targets
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {METRIC_DEFINITIONS.map((def) => (
          <MetricCard
            key={def.key}
            definition={def}
            latestRecord={latestByKey.get(def.key) ?? null}
            history={historyByKey.get(def.key) ?? []}
            facilityTier={facilityTier}
          />
        ))}
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400">
        Metric values are entered manually. Phase 22 does not integrate EHR data.
      </p>
    </div>
  );
}
