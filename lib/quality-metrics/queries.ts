/**
 * Quality Metrics -- Supabase Queries
 *
 * Server-side queries for quality metric records.
 */

import { METRIC_DEFINITIONS } from './constants';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QualityMetricRecord, MetricKey, MonthlyTrend } from './types';

/**
 * Fetch the most recent quality metric record per metric_key for a provider.
 * Returns one record per metric (or none if no data exists).
 */
export async function getQualityMetrics(
  supabase: SupabaseClient,
  providerId: string,
): Promise<QualityMetricRecord[]> {
  // Read the latest row independently for each measure. A busy measure cannot
  // displace another measure's latest row beyond the API's page limit.
  const records = await Promise.all(METRIC_DEFINITIONS.map(async ({ key }) => {
    const { data, error } = await supabase.from('quality_metric_records').select('*')
      .eq('provider_id', providerId).eq('metric_key', key)
      .order('period_month', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as QualityMetricRecord | null;
  }));
  return records.filter((row): row is QualityMetricRecord => row !== null);
}

/**
 * Fetch monthly trend data for a specific metric over the last N months.
 * Returns MonthlyTrend[] ordered by period_month ascending.
 *
 * Default window: 6 months (current month + 5 previous).
 * Month bounds use the UTC calendar and exclude future reporting months.
 */
export async function getMetricHistory(
  supabase: SupabaseClient,
  providerId: string,
  metricKey: MetricKey,
  months: number = 6,
): Promise<MonthlyTrend[]> {
  const now = new Date();
  const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('quality_metric_records')
    .select('period_month, rate_pct')
    .eq('provider_id', providerId)
    .eq('metric_key', metricKey)
    .gte('period_month', month(1 - months)).lt('period_month', month(1))
    .order('period_month', { ascending: true });

  if (error) throw error;
  if (!data) throw new Error('Quality metric source unavailable.');
  return data as MonthlyTrend[];
}
