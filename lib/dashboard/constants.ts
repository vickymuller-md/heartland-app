/**
 * HEARTLAND Provider Dashboard -- Constants
 *
 * Clinical thresholds from HEARTLAND Protocol v3.3 Module 5 Section 5.2.
 * Shared by alert evaluation engine (lib + Edge Function) and UI components.
 *
 * Source: reference/clinical_content.md Section 5.2 Red Flag Alert Criteria
 */

import type { AlertFlag, AlertSeverity, PatientStatus, SortKey } from './types';

// ---------- HEARTLAND Protocol Module 5 Red Flag Thresholds ----------

export const CRITICAL_THRESHOLDS = {
  /** Weight gain >= 3 lbs in 2 days: "Call clinic same day" */
  WEIGHT_GAIN_2D_LBS: 3,
  /** Weight gain >= 5 lbs in 7 days: "Urgent evaluation within 24h" */
  WEIGHT_GAIN_7D_LBS: 5,
  /** SBP < 90 mmHg: "Hold GDMT; call provider" */
  SBP_LOW: 90,
  /** SpO2 < 92% at rest: "Urgent evaluation" */
  SPO2_LOW: 92,
} as const;

// ---------- Alert Flag Labels (human-readable) ----------

export const FLAG_LABELS: Record<AlertFlag, string> = {
  weight_gain_3lb_2d: 'Weight gain \u22653 lbs in 2 days',
  weight_gain_5lb_7d: 'Weight gain \u22655 lbs in 1 week',
  sbp_low: 'SBP < 90 mmHg',
  spo2_low: 'SpO2 < 92%',
  symptom_red_flag: 'Red flag symptom reported',
  dyspnea_severe: 'Severe dyspnea at rest',
  no_checkin: 'No vitals check-in',
  low_adherence: 'Low medication adherence',
  weight_trend_7d: 'Gradual weight trend \u22652 lbs/7d',
  hyperkalemia: 'K\u207a > 5.5 mEq/L',
  low_egfr: 'eGFR < 30 mL/min',
  followup_due: 'Follow-up due',
  followup_overdue: 'Follow-up overdue',
};

// ---------- Flags that indicate critical severity ----------

export const CRITICAL_FLAGS: AlertFlag[] = [
  'sbp_low',
  'spo2_low',
  'weight_gain_3lb_2d',
  'symptom_red_flag',
];

// ---------- Severity Colors (Tailwind CSS classes) ----------

export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  warning: 'text-amber-600 bg-amber-50 border-amber-200',
  informational: 'text-blue-600 bg-blue-50 border-blue-200',
};

// ---------- Status Colors ----------

export const STATUS_COLORS: Record<PatientStatus, string> = {
  critical: 'text-red-600 bg-red-100',
  alert: 'text-amber-600 bg-amber-100',
  stable: 'text-green-600 bg-green-100',
};

// ---------- Sort Priority Maps ----------

/** Lower number = higher priority (sorted first) */
export const STATUS_PRIORITY: Record<PatientStatus, number> = {
  critical: 0,
  alert: 1,
  stable: 2,
};

/** Lower number = higher priority (sorted first) */
export const RISK_TIER_PRIORITY: Record<string, number> = {
  very_high: 0,
  high: 0,
  moderate: 1,
  low: 2,
};

// ---------- Sort Options for UI ----------

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'status', label: 'Alert Status' },
  { value: 'vitals_date', label: 'Last Vitals' },
  { value: 'risk_tier', label: 'Risk Tier' },
];

// ---------- Proactive Alert Mappings (Phase 14) ----------

/** Maps each proactive alert flag to its severity level */
export const PROACTIVE_FLAG_SEVERITY: Record<string, AlertSeverity> = {
  no_checkin: 'informational',
  low_adherence: 'warning',
  weight_trend_7d: 'warning',
  hyperkalemia: 'critical',
  low_egfr: 'critical',
  followup_due: 'informational',
  followup_overdue: 'warning',
};

/** Clinical thresholds for proactive alert detection */
export const PROACTIVE_THRESHOLDS = {
  NO_CHECKIN_DAYS: 3,
  LOW_ADHERENCE_PCT: 70,
  WEIGHT_TREND_LBS: 2,
  HYPERKALEMIA_K: 5.5,
  LOW_EGFR: 30,
  FOLLOWUP_WINDOW_HOURS: 24,
} as const;

/** Alert types that cannot be muted -- patient safety critical. */
export const PROTECTED_ALERT_TYPES: string[] = [
  'sbp_low',
  'spo2_low',
  'hyperkalemia',
];

/** Deduplication windows in hours for each proactive alert type */
export const PROACTIVE_DEDUP_HOURS: Record<string, number> = {
  no_checkin: 72,
  low_adherence: 48,
  weight_trend_7d: 24,
  hyperkalemia: 24,
  low_egfr: 24,
  followup_due: 12,
  followup_overdue: 24,
};
