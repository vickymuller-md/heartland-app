/**
 * HEARTLAND Reports & Data Export -- TypeScript Types
 *
 * Types for monthly report aggregation, patient summary export,
 * and CSV builder functions.
 *
 * Requirements: REPT-01 through REPT-04
 * Source: HEARTLAND Protocol v3.3 -- Phase 21
 */

import type { PatientDetailData } from '@/lib/dashboard/types';

// ---------- Date Range ----------

export interface ReportDateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

// ---------- Monthly Report ----------

export interface MonthlyReportData {
  month: string;                        // "2026-03"
  from: string;
  to: string;
  totalPatients: number;
  activePatientsInPeriod: number;
  alertsGenerated: number;
  alertsCritical: number;
  titrationNotesCount: number;
  avgCheckInCompliance: number;         // 0-100 percentage
  gdmtOptimizationRate: number | null;  // null if Phase 13 not complete
}

// ---------- Patient Summary ----------

export interface PatientSummaryData extends PatientDetailData {
  labs: LabResultRow[];
  dateRange: ReportDateRange;
}

// ---------- Lab Results ----------

export interface LabResultRow {
  id: string;
  patient_id: string;
  test_name: string;
  value: number;
  unit: string;
  collected_at: string;
  flag: 'normal' | 'low' | 'high' | 'critical' | null;
}

// ---------- CSV Builder Types ----------

export interface DeidentifyOptions {
  deidentify: boolean;
  patientMap?: Map<string, string>;
}

/** Raw vitals row for CSV export (matches vitals table columns) */
export interface VitalsRow {
  patient_id: string;
  recorded_at: string;
  weight_lbs: number | null;
  sbp: number | null;
  dbp: number | null;
  heart_rate: number | null;
  spo2: number | null;
}

/** Raw medication log row for CSV export */
export interface MedLogRow {
  patient_id: string;
  medication_name: string;
  dose: string;
  frequency: string;
  taken_at: string;
  taken: boolean;
}

// ---------- NIW Traction Report (REPT-06) ----------

export interface MonthlyCount {
  month: string; // "YYYY-MM"
  providers: number;
  patients: number;
}

export interface NiwTractionData {
  totalProviders: number;
  totalPatients: number;
  totalAlerts: number;
  totalTitrations: number;
  activeStates: string[]; // unique full state names (matches us-atlas properties.name)
  monthlyGrowth: MonthlyCount[]; // last 12 months, zero-filled
  /**
   * Providers who completed registration. Because provider registration
   * requires a valid invite code issued by the protocol admin, every
   * registered provider is by definition "approved" — i.e. this equals
   * totalProviders. Surfaced separately so monthly reports can state the
   * "manual approval" claim explicitly for the NIW petition.
   */
  approvedProviders: number;
  /**
   * Access requests awaiting manual review (status='pending' in access_requests).
   */
  pendingAccessRequests: number;
  activeSandboxAccounts: number;
  uniqueSandboxTesters30d: number;
  sandboxViews30d: number;
  sandboxFirstActions30d: number;
  sandboxTaskCompletions30d: number;
  sandboxActivationRate30d: number | null;
  medianSandboxDurationSeconds: number | null;
}
