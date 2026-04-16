/**
 * HEARTLAND Reports & Data Export -- Query Functions
 *
 * Server-side query functions for report data aggregation.
 * All functions accept a SupabaseClient from lib/supabase/server.ts.
 *
 * Requirements: REPT-01 (Monthly Report), REPT-02 (Patient Summary)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MonthlyReportData,
  PatientSummaryData,
  ReportDateRange,
  LabResultRow,
  NiwTractionData,
  MonthlyCount,
} from './types';
import { getPatientDetail } from '@/lib/dashboard/queries';

// Re-export types for consumers that import from queries
export type { MonthlyReportData, PatientSummaryData, NiwTractionData, MonthlyCount } from './types';

/**
 * Aggregate monthly report data for a provider's linked patients.
 * REPT-01: Monthly panel report with patient counts, alerts, compliance.
 */
export async function getMonthlyReportData(
  supabase: SupabaseClient,
  providerId: string,
  range: ReportDateRange
): Promise<MonthlyReportData> {
  // Derive month string from range.from
  const month = range.from.slice(0, 7); // "YYYY-MM"

  // 1. Fetch linked patient IDs
  const { data: links, error: linkError } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  if (linkError) throw linkError;

  const patientIds = (links ?? []).map((l) => l.patient_id);
  const totalPatients = patientIds.length;

  // Return zeroed data if no linked patients
  if (totalPatients === 0) {
    return {
      month,
      from: range.from,
      to: range.to,
      totalPatients: 0,
      activePatientsInPeriod: 0,
      alertsGenerated: 0,
      alertsCritical: 0,
      titrationNotesCount: 0,
      avgCheckInCompliance: 0,
      gdmtOptimizationRate: null,
    };
  }

  // 2. Fetch vitals in range for compliance and active patient calculation
  const { data: vitals, error: vitalsError } = await supabase
    .from('vitals')
    .select('patient_id, recorded_at')
    .in('patient_id', patientIds)
    .gte('recorded_at', range.from)
    .lte('recorded_at', range.to);

  if (vitalsError) throw vitalsError;

  // Compute active patients (unique patient_ids with vitals in range)
  const activePatientIds = new Set<string>();
  // Compute distinct calendar days per patient for compliance
  const daysPerPatient = new Map<string, Set<string>>();

  for (const v of vitals ?? []) {
    activePatientIds.add(v.patient_id);
    const daySet = daysPerPatient.get(v.patient_id) ?? new Set<string>();
    // Extract calendar day from recorded_at (YYYY-MM-DD)
    daySet.add(v.recorded_at.slice(0, 10));
    daysPerPatient.set(v.patient_id, daySet);
  }

  const activePatientsInPeriod = activePatientIds.size;

  // Compliance: patients with >=16 distinct vitals days / total linked patients * 100
  let compliantCount = 0;
  for (const [, days] of daysPerPatient) {
    if (days.size >= 16) {
      compliantCount++;
    }
  }
  const avgCheckInCompliance =
    totalPatients > 0
      ? Math.round((compliantCount / totalPatients) * 1000) / 10
      : 0;

  // 3. Fetch alerts in range
  const { data: alertsData, error: alertsError } = await supabase
    .from('alerts')
    .select('id, severity')
    .in('patient_id', patientIds)
    .gte('created_at', range.from)
    .lte('created_at', range.to);

  if (alertsError) throw alertsError;

  const alertsGenerated = (alertsData ?? []).length;
  const alertsCritical = (alertsData ?? []).filter(
    (a) => a.severity === 'critical'
  ).length;

  // 4. Fetch titration notes count
  const { count: titrationCount, error: notesError } = await supabase
    .from('provider_notes')
    .select('id', { count: 'exact', head: true })
    .in('patient_id', patientIds)
    .ilike('content', '[Titration]%')
    .gte('created_at', range.from)
    .lte('created_at', range.to);

  if (notesError) throw notesError;

  return {
    month,
    from: range.from,
    to: range.to,
    totalPatients,
    activePatientsInPeriod,
    alertsGenerated,
    alertsCritical,
    titrationNotesCount: titrationCount ?? 0,
    avgCheckInCompliance,
    gdmtOptimizationRate: null, // Phase 13 not complete
  };
}

/**
 * Get full patient summary data for PDF export.
 * REPT-02: Patient summary with detail data + labs within date range.
 */
export async function getPatientSummaryData(
  supabase: SupabaseClient,
  patientId: string,
  providerId: string,
  range: ReportDateRange
): Promise<PatientSummaryData | null> {
  // 1. Get patient detail (reuse dashboard query)
  // Note: getPatientDetail signature is (supabase, providerId, patientId)
  const detail = await getPatientDetail(supabase, providerId, patientId);
  if (!detail) return null;

  // 2. Fetch lab results within date range
  const { data: labsData, error: labsError } = await supabase
    .from('lab_results')
    .select('id, patient_id, test_name, value, unit, collected_at, flag')
    .eq('patient_id', patientId)
    .gte('collected_at', range.from)
    .lte('collected_at', range.to)
    .order('collected_at', { ascending: false });

  if (labsError) throw labsError;

  return {
    ...detail,
    labs: (labsData ?? []) as LabResultRow[],
    dateRange: range,
  };
}

// ---------- NIW Traction Report (REPT-06) ----------

/**
 * Pure helper: build last 12 months with per-month provider/patient counts.
 * Exported for unit testing without Supabase dependency.
 */
export function computeMonthlyGrowth(
  providerRows: { created_at: string }[],
  patientRows: { created_at: string }[]
): MonthlyCount[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    );
  }
  const countByMonth = (rows: { created_at: string }[], month: string) =>
    rows.filter((r) => r.created_at.slice(0, 7) === month).length;
  return months.map((month) => ({
    month,
    providers: countByMonth(providerRows, month),
    patients: countByMonth(patientRows, month),
  }));
}

/**
 * Aggregate platform-wide NIW traction stats using admin client.
 * REPT-06: Cumulative totals + geographic spread + monthly growth for NIW petition.
 * Must be called from Server Components only (uses service_role key).
 */
export async function getNiwTractionStats(): Promise<NiwTractionData> {
  // Dynamic import to avoid bundling server-only module in client
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  const [
    { count: totalProviders },
    { count: totalPatients },
    { count: totalAlerts },
    { count: totalTitrations },
    { count: pendingAccessRequests },
    { data: stateRows },
    { data: providersByMonth },
    { data: patientsByMonth },
  ] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'provider'),
    supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'patient'),
    supabaseAdmin
      .from('alerts')
      .select('id', { count: 'exact', head: true }),
    supabaseAdmin
      .from('provider_notes')
      .select('id', { count: 'exact', head: true })
      .ilike('content', '[Titration]%'),
    supabaseAdmin
      .from('access_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabaseAdmin
      .from('profiles')
      .select('state')
      .not('state', 'is', null),
    supabaseAdmin
      .from('profiles')
      .select('created_at')
      .eq('role', 'provider'),
    supabaseAdmin
      .from('profiles')
      .select('created_at')
      .eq('role', 'patient'),
  ]);

  const activeStates = [
    ...new Set(
      (stateRows ?? [])
        .map((r) => r.state as string)
        .filter(Boolean)
    ),
  ];
  const monthlyGrowth = computeMonthlyGrowth(
    providersByMonth ?? [],
    patientsByMonth ?? []
  );

  const providerCount = totalProviders ?? 0;

  return {
    totalProviders: providerCount,
    totalPatients: totalPatients ?? 0,
    totalAlerts: totalAlerts ?? 0,
    totalTitrations: totalTitrations ?? 0,
    activeStates,
    monthlyGrowth,
    approvedProviders: providerCount,
    pendingAccessRequests: pendingAccessRequests ?? 0,
  };
}
