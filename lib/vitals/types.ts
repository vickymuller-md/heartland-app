/**
 * HEARTLAND Patient Vitals & Symptoms -- Type Definitions
 *
 * Types match the Supabase schema (vitals/symptoms tables, Phase 1 migration)
 * and the HEARTLAND Protocol v3.3 Module 5 red flag criteria.
 */

/** Symptom severity scale: 0=none, 1=mild, 2=moderate, 3=severe */
export type SymptomSeverity = 0 | 1 | 2 | 3;

/** Row from the vitals table (Supabase) */
export interface VitalsRow {
  id: string;
  patient_id: string;
  recorded_at: string;
  weight_lbs: number;
  sbp: number;
  dbp: number;
  heart_rate: number;
  spo2: number | null;
  source: 'patient_app' | 'provider_entry';
}

/** Row from the symptoms table (Supabase) */
export interface SymptomsRow {
  id: string;
  patient_id: string;
  recorded_at: string;
  dyspnea: SymptomSeverity;
  edema: SymptomSeverity;
  orthopnea: boolean;
  fatigue: SymptomSeverity;
  red_flag: boolean;
}

/** Red flag detection result */
export interface RedFlag {
  id: string;
  severity: 'warning' | 'critical';
  message: string;
  action: string;
}

/** Plausibility warning on a single vitals field (non-blocking). */
export interface PlausibilityWarning {
  field: 'weight_lbs' | 'sbp' | 'dbp' | 'heart_rate' | 'spo2';
  value: number;
  message: string;
}

/** Form input values before conversion (matches Zod schema output) */
export interface VitalsInput {
  weight: number;
  weightUnit: 'lbs' | 'kg';
  sbp: number;
  dbp: number;
  heartRate: number;
  spo2?: number;
  dyspnea: SymptomSeverity;
  edema: SymptomSeverity;
  orthopnea: boolean;
  fatigue: SymptomSeverity;
}

/** Data point for vitals trend chart (Plan 07-02) */
export interface VitalsDataPoint {
  date: string;
  weight: number;
  sbp: number;
  dbp: number;
  hr: number;
  spo2?: number;
}

/** Server Action return state */
export interface VitalsActionState {
  success?: boolean;
  vitals?: VitalsRow;
  redFlags?: RedFlag[];
  errors?: Record<string, string[]>;
  error?: string;
}

/** Result for a single row in a batch vitals submission */
export interface BatchRowResult {
  /** 0-indexed row position in the batch (0 = oldest day) */
  rowIndex: number;
  /** ISO date string (YYYY-MM-DD) for this entry */
  date: string;
  /** True if this row was saved successfully */
  success: boolean;
  /** Red flags triggered by this row (empty if none) */
  redFlags: RedFlag[];
  /** Validation or insert error message (undefined if success) */
  error?: string;
  /** True if this row was skipped because all measurement fields were blank */
  skipped?: boolean;
}

/** Server Action return state for submitBatchVitalsAsProvider */
export interface BatchVitalsActionState {
  /** Per-row results array (length = number of non-skipped rows attempted) */
  results?: BatchRowResult[];
  /** True if at least one row triggered a red flag */
  anyRedFlags?: boolean;
  /** Top-level error (auth failure, patient not linked) */
  error?: string;
}
