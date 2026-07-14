/**
 * HEARTLAND Provider Dashboard -- Metrics Types
 *
 * Types for portfolio-level aggregate metrics, RPM billing eligibility,
 * and sparkline trend data.
 *
 * Requirements: METR-01 through METR-05
 * Source: HEARTLAND Protocol v3.3; CMS 2023 Physician Fee Schedule
 */

// ---------- Provider Metrics (METR-01) ----------

/** Aggregate metrics for a provider's patient portfolio */
export interface ProviderMetrics {
  /** Total number of actively linked patients */
  totalPatients: number;
  /** Count of open (unresolved) alerts across all patients */
  activeAlerts: number;
  /** Patients with no vitals submission in the last 3 days */
  noCheckinCount: number;
  /** Average medication adherence across all patients, 0-100 */
  avgAdherence: number;
  /** Patients with >=16 distinct app-entry days this month; not billing eligibility */
  rpmDataCompletenessCount: number;
  /** Percentage of HFrEF patients on >=3 of 4 GDMT drug classes, 0-100 */
  gdmtOptRate: number;
}

/** Zero-state metrics for providers with no linked patients */
export const EMPTY_METRICS: ProviderMetrics = {
  totalPatients: 0,
  activeAlerts: 0,
  noCheckinCount: 0,
  avgAdherence: 0,
  rpmDataCompletenessCount: 0,
  gdmtOptRate: 0,
};

// ---------- Sparkline Trend (METR-04) ----------

/** Data point for weekly trend sparkline charts */
export interface MetricTrend {
  /** Week label (e.g., 'W1', 'W2', or ISO week string) */
  week: string;
  /** Metric value for that week */
  value: number;
}

// ---------- RPM Eligibility (METR-03) ----------

/** Patient qualifying for RPM billing under CPT 99454 */
export interface RpmDataCompletenessPatient {
  id: string;
  /** Patient display name */
  full_name: string;
  /** Number of distinct calendar days with vitals this month */
  vitals_days_this_month: number;
}
