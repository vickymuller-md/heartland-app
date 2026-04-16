/**
 * Quality Metrics -- TypeScript Types
 *
 * Types for the quality metrics tracking module.
 * Source: HEARTLAND Protocol v3.3 Module 8, Section 8.1
 */

export type MetricKey =
  | 'contact_48_72h'
  | 'gdmt_discharge_rate'
  | 'followup_7day'
  | 'readmission_30day'
  | 'teachback_documentation';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  tier1Target: number | null;    // null for 'Improvement from baseline'
  tier1TargetLabel: string;      // human-readable (matches QUALITY_METRICS)
  tier23Target: number | null;
  tier23TargetLabel: string;
  higherIsBetter: boolean;
}

export interface QualityMetricRecord {
  id: string;
  provider_id: string;
  metric_key: MetricKey;
  period_month: string;     // 'yyyy-MM-dd'
  numerator: number | null;
  denominator: number | null;
  rate_pct: number | null;
  notes: string | null;
  created_at: string;
}

export interface MonthlyTrend {
  period_month: string;
  rate_pct: number | null;
}
