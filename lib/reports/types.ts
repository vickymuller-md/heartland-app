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
import type { AdherenceDay } from '@/lib/medications/types';
import type { getEducationSummary } from '@/lib/education/queries';

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
  avgCheckInCompliance: number | null;         // 0-100 percentage
  gdmtOptimizationRate: number | null;  // null if Phase 13 not complete
}

// ---------- Patient Summary ----------

export interface PatientSummaryData {
  patient: PatientDetailData['patient'];
  vitals: PatientDetailData['vitals'];
  notes: Array<{ id: string; content: string; created_at: string }>;
  openAlerts: Array<Pick<PatientDetailData['openAlerts'][number], 'id' | 'flags' | 'severity' | 'created_at'>>;
  adherenceSummary: AdherenceDay[] | null;
  educationProgress: Awaited<ReturnType<typeof getEducationSummary>> | null;
  labs: LabResultRow[];
  dateRange: ReportDateRange;
}

// ---------- Lab Results ----------

export interface LabResultRow {
  id: string;
  patient_id: string;
  test_name: string;
  value: string | null;
  unit: string;
  collected_at: string;
  flag: 'normal' | 'low' | 'high' | 'critical' | null;
  source_status: 'original' | 'corrected' | 'cancelled';
  root_id: string | null;
  version_id: string | null;
  revision: string | null;
  original_lab_result_id: string;
  effective_lab_result_id: string | null;
  evaluation_status: 'pending' | 'recorded' | 'not_required' | 'invalidated' | null;
  data_quality: 'recorded' | 'invalid' | 'cancelled';
  quality_reason: string;
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
  taken_at: string | null;
  taken: boolean;
  scheduled_date: string;
  dose_number: number;
  schedule_recorded: boolean;
  calendar_time_zone?: string | null;
  calendar_source?: string | null;
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
  approvedAccessRequests: number; // status='approved' in access_requests
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
  campaignSources30d: Array<{ source: string; sessions: number }>;
}
