/**
 * HEARTLAND Provider Dashboard -- TypeScript Types
 *
 * Types for the provider-facing patient monitoring dashboard,
 * alert pipeline, and provider notes system.
 *
 * Requirements: DASH-01 through DASH-09
 * Source: HEARTLAND Protocol v3.3
 */

// ---------- Enums / Unions ----------

export type PatientStatus = 'stable' | 'alert' | 'critical';
export type AlertSeverity = 'critical' | 'warning' | 'informational';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type AlertFlag =
  | 'weight_gain_3lb_2d'
  | 'weight_gain_5lb_7d'
  | 'sbp_low'
  | 'spo2_low'
  | 'symptom_red_flag'
  | 'dyspnea_severe'
  | 'no_checkin'
  | 'low_adherence'
  | 'weight_trend_7d'
  | 'hyperkalemia'
  | 'low_egfr'
  | 'followup_due'
  | 'followup_overdue';
export type SortKey = 'status' | 'vitals_date' | 'risk_tier';

// ---------- Dashboard Data ----------

/** Patient row with computed status for the patient list (DASH-01) */
export interface PatientWithStatus {
  id: string;
  full_name: string;
  risk_tier: string | null;
  track_assignment: string | null;
  status: PatientStatus;
  open_alert_count: number;
  last_vitals_at: string | null;
  latest_flags: AlertFlag[] | null;
  setup_complete: boolean;
}

/** Alert row for the alert inbox (DASH-05) */
export interface AlertRow {
  id: string;
  patient_id: string;
  patient_name: string;
  vitals_id: string | null;
  flags: AlertFlag[];
  severity: AlertSeverity;
  status: AlertStatus;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  occurrence_count?: number;
  first_seen_at?: string;
  last_seen_at?: string;
}

/** Provider note attached to a patient record (DASH-09) */
export interface ProviderNote {
  id: string;
  patient_id: string;
  provider_id: string;
  provider_name: string;
  content: string;
  created_at: string;
}

/** Aggregated patient detail data for the detail view (DASH-03) */
export interface PatientDetailData {
  patient: {
    id: string;
    full_name: string;
    risk_tier: string | null;
    track_assignment: string | null;
  };
  vitals: VitalsChartPoint[];
  symptoms: SymptomEntry[];
  adherenceSummary: unknown; // from Phase 9 getAdherenceData
  educationProgress: unknown; // from Phase 9 getEducationSummary
  notes: ProviderNote[];
  openAlerts: AlertRow[];
}

/** Data point for vitals trend chart in patient detail (DASH-03) */
export interface VitalsChartPoint {
  date: string;
  weight_lbs: number | null;
  sbp: number | null;
  dbp: number | null;
  heart_rate: number | null;
  spo2: number | null;
}

/** Simplified symptom entry for patient detail symptom history */
export interface SymptomEntry {
  id: string;
  recorded_at: string;
  dyspnea: number;
  edema: number;
  orthopnea: number;
  fatigue: number;
  red_flag: boolean;
}

// ---------- Alert Engine Input Types ----------

/** Vitals snapshot for alert evaluation (subset of full VitalsRow) */
export interface AlertVitalsInput {
  weight_lbs: number | null;
  sbp: number | null;
  dbp: number | null;
  heart_rate: number | null;
  spo2: number | null;
  recorded_at: string;
}

/** Recent vitals entry for weight comparison */
export interface RecentVitalsEntry {
  weight_lbs: number | null;
  recorded_at: string;
}

/** Recent symptom data for alert evaluation */
export interface RecentSymptomInput {
  dyspnea: 0 | 1 | 2 | 3;
  edema: 0 | 1 | 2 | 3;
  orthopnea: boolean;
  fatigue: 0 | 1 | 2 | 3;
  red_flag: boolean;
}

/** Existing alert subset for deduplication check */
export interface ExistingAlertForDedup {
  flags: string[];
  status: AlertStatus | string;
  created_at: string;
}
