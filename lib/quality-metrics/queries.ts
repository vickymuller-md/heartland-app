/**
 * Quality Metrics -- Supabase Queries
 *
 * Server-side queries for quality metric records.
 * Uses date-fns for consistent date window calculation.
 */

import { startOfMonth, subMonths, format } from 'date-fns';
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
  const { data, error } = await supabase
    .from('quality_metric_records')
    .select('*')
    .eq('provider_id', providerId)
    .order('period_month', { ascending: false });

  if (error || !data) return [];

  // Deduplicate: keep only the most recent record per metric_key
  const seen = new Set<string>();
  const latest: QualityMetricRecord[] = [];
  for (const row of data) {
    if (!seen.has(row.metric_key)) {
      seen.add(row.metric_key);
      latest.push(row as QualityMetricRecord);
    }
  }
  return latest;
}

/**
 * Fetch monthly trend data for a specific metric over the last N months.
 * Returns MonthlyTrend[] ordered by period_month ascending.
 *
 * Default window: 6 months (current month + 5 previous).
 * Cutoff: startOfMonth(subMonths(today, months - 1))
 */
export async function getMetricHistory(
  supabase: SupabaseClient,
  providerId: string,
  metricKey: MetricKey,
  months: number = 6,
): Promise<MonthlyTrend[]> {
  const cutoff = format(startOfMonth(subMonths(new Date(), months - 1)), 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from('quality_metric_records')
    .select('period_month, rate_pct')
    .eq('provider_id', providerId)
    .eq('metric_key', metricKey)
    .gte('period_month', cutoff)
    .order('period_month', { ascending: true });

  if (error || !data) return [];
  return data as MonthlyTrend[];
}
