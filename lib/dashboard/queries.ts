/**
 * HEARTLAND Provider Dashboard -- Supabase Query Functions
 *
 * All functions accept a SupabaseClient parameter for use in Server Components
 * via createClient from lib/supabase/server.ts (Phase 1).
 *
 * Requirements: DASH-01 through DASH-05, DASH-09
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sortPatients } from './alert-engine';
import { getAdherenceData } from '@/lib/medications/queries';
import { getEducationSummary } from '@/lib/education/queries';
import { ALL_STEPS_COMPLETE } from '@/lib/onboarding/constants';
import { extractFullName, extractPatientFullName } from '@/lib/supabase/types';
import type {
  PatientWithStatus,
  PatientStatus,
  AlertRow,
  AlertFlag,
  AlertSeverity,
  AlertStatus,
  ProviderNote,
  PatientDetailData,
  VitalsChartPoint,
  SymptomEntry,
  SortKey,
} from './types';

/**
 * Get all linked patients for a provider with computed status.
 * DASH-01: Patient list with status badges
 * DASH-02: Sort support
 * DASH-04: Alert badge counts
 */
export async function getLinkedPatients(
  supabase: SupabaseClient,
  providerId: string,
  sortBy: SortKey = 'status'
): Promise<PatientWithStatus[]> {
  // 1. Get active patient links
  const { data: links, error: linkError } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  const patientIds = links.map((l) => l.patient_id);

  // 2. Batch fetch patient profiles
  const { data: patients, error: patientError } = await supabase
    .from('patients')
    .select('id, risk_tier, track_assignment, setup_completed_steps, profiles(full_name)')
    .in('id', patientIds);

  if (patientError) throw patientError;

  // 3. Fetch open alerts per patient
  const { data: alerts, error: alertError } = await supabase
    .from('alerts')
    .select('patient_id, severity, flags')
    .in('patient_id', patientIds)
    .eq('status', 'open');

  if (alertError) throw alertError;

  // 4. Fetch latest vitals date per patient
  const { data: latestVitals, error: vitalsError } = await supabase
    .from('vitals')
    .select('patient_id, recorded_at')
    .in('patient_id', patientIds)
    .order('recorded_at', { ascending: false });

  if (vitalsError) throw vitalsError;

  // Build lookup maps
  const alertsByPatient = new Map<
    string,
    Array<{ severity: string; flags: string[] }>
  >();
  for (const alert of alerts ?? []) {
    const arr = alertsByPatient.get(alert.patient_id) ?? [];
    arr.push({ severity: alert.severity, flags: alert.flags });
    alertsByPatient.set(alert.patient_id, arr);
  }

  const latestVitalsByPatient = new Map<string, string>();
  for (const v of latestVitals ?? []) {
    if (!latestVitalsByPatient.has(v.patient_id)) {
      latestVitalsByPatient.set(v.patient_id, v.recorded_at);
    }
  }

  // 5. Build PatientWithStatus array
  const result: PatientWithStatus[] = (patients ?? []).map((p) => {
    const patientAlerts = alertsByPatient.get(p.id) ?? [];
    const openCount = patientAlerts.length;

    // Compute status: critical if any critical alert, alert if any open, else stable
    let status: PatientStatus = 'stable';
    if (openCount > 0) {
      const hasCritical = patientAlerts.some((a) => a.severity === 'critical');
      status = hasCritical ? 'critical' : 'alert';
    }

    // Collect latest flags from most recent alert
    const latestFlags =
      patientAlerts.length > 0
        ? (patientAlerts[0].flags as AlertFlag[])
        : null;

    return {
      id: p.id,
      full_name: extractFullName(p.profiles) ?? 'Unknown',
      risk_tier: p.risk_tier,
      track_assignment: p.track_assignment,
      status,
      open_alert_count: openCount,
      last_vitals_at: latestVitalsByPatient.get(p.id) ?? null,
      latest_flags: latestFlags,
      setup_complete: ((p as Record<string, unknown>).setup_completed_steps as number ?? 0) === ALL_STEPS_COMPLETE,
    };
  });

  return sortPatients(result, sortBy);
}

/**
 * Get full patient detail for the patient detail view.
 * DASH-03: Vitals trends, symptoms, medications, education, notes
 */
export async function getPatientDetail(
  supabase: SupabaseClient,
  providerId: string,
  patientId: string
): Promise<PatientDetailData | null> {
  // 1. Security check: verify provider-patient link exists
  const { data: link } = await supabase
    .from('provider_patient_links')
    .select('id')
    .eq('provider_id', providerId)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();

  if (!link) return null; // Unauthorized

  // 2. Fetch patient profile
  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id, risk_tier, track_assignment, profiles(full_name)')
    .eq('id', patientId)
    .single();

  if (patientError) throw patientError;

  const patientFullName = extractFullName(patient.profiles) ?? 'Unknown';

  // 3. Fetch vitals (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data: vitals } = await supabase
    .from('vitals')
    .select('recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2')
    .eq('patient_id', patientId)
    .gte('recorded_at', ninetyDaysAgo.toISOString())
    .order('recorded_at', { ascending: true });

  // 4. Fetch symptoms (last 90 days)
  const { data: symptoms } = await supabase
    .from('symptoms')
    .select('id, recorded_at, dyspnea, edema, orthopnea, fatigue, red_flag')
    .eq('patient_id', patientId)
    .gte('recorded_at', ninetyDaysAgo.toISOString())
    .order('recorded_at', { ascending: false });

  // 5. Fetch medication adherence (reuse Phase 9)
  let adherenceSummary: unknown = null;
  try {
    adherenceSummary = await getAdherenceData(supabase, patientId, 30);
  } catch {
    // Medication data may not exist yet
  }

  // 6. Fetch education progress (reuse Phase 9)
  let educationProgress: unknown = null;
  try {
    educationProgress = await getEducationSummary(supabase, patientId);
  } catch {
    // Education data may not exist yet
  }

  // 7. Fetch provider notes
  const notes = await getProviderNotes(supabase, patientId);

  // 8. Fetch open alerts
  const { data: openAlerts } = await supabase
    .from('alerts')
    .select('id, patient_id, vitals_id, flags, severity, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, created_at')
    .eq('patient_id', patientId)
    .in('status', ['open', 'acknowledged'])
    .order('created_at', { ascending: false });

  return {
    patient: {
      id: patient.id,
      full_name: patientFullName,
      risk_tier: patient.risk_tier,
      track_assignment: patient.track_assignment,
    },
    vitals: (vitals ?? []).map((v) => ({
      date: v.recorded_at,
      weight_lbs: v.weight_lbs,
      sbp: v.sbp,
      dbp: v.dbp,
      heart_rate: v.heart_rate,
      spo2: v.spo2,
    })) as VitalsChartPoint[],
    symptoms: (symptoms ?? []) as SymptomEntry[],
    adherenceSummary,
    educationProgress,
    notes,
    openAlerts: (openAlerts ?? []).map((a) => ({
      ...a,
      patient_name: patientFullName,
    })) as AlertRow[],
  };
}

/**
 * Get alerts for all linked patients with filtering.
 * DASH-05: Alert inbox
 */
export async function getAlerts(
  supabase: SupabaseClient,
  providerId: string,
  statusFilter?: AlertStatus | 'all',
  pagination: { limit?: number; offset?: number } = {},
): Promise<{ alerts: AlertRow[]; total: number }> {
  const limit = Math.min(Math.max(pagination.limit ?? 25, 1), 50);
  const offset = Math.max(pagination.offset ?? 0, 0);
  // Get linked patient IDs
  const { data: links } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  if (!links || links.length === 0) return { alerts: [], total: 0 };
  const patientIds = links.map((l) => l.patient_id);

  // Build query with optional status filter
  let query = supabase
    .from('alerts')
    .select('id, patient_id, vitals_id, flags, severity, status, acknowledged_by, acknowledged_at, resolved_by, resolved_at, created_at, occurrence_count, first_seen_at, last_seen_at, patients!inner(profiles(full_name))', { count: 'exact' })
    .in('patient_id', patientIds)
    .order('last_seen_at', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const alerts = (data ?? []).map((row) => {
    return {
      id: row.id,
      patient_id: row.patient_id,
      patient_name: extractPatientFullName(row.patients) ?? 'Unknown',
      vitals_id: row.vitals_id,
      flags: row.flags as AlertFlag[],
      severity: row.severity as AlertSeverity,
      status: row.status as AlertStatus,
      acknowledged_by: row.acknowledged_by,
      acknowledged_at: row.acknowledged_at,
      resolved_by: row.resolved_by,
      resolved_at: row.resolved_at,
      created_at: row.created_at,
      occurrence_count: row.occurrence_count,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
    };
  });
  return { alerts, total: count ?? 0 };
}

/**
 * Get provider notes for a patient.
 * DASH-09: Provider notes display
 */
export async function getProviderNotes(
  supabase: SupabaseClient,
  patientId: string
): Promise<ProviderNote[]> {
  const { data, error } = await supabase
    .from('provider_notes')
    .select('id, patient_id, provider_id, content, created_at, profiles!provider_id(full_name)')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    return {
      id: row.id,
      patient_id: row.patient_id,
      provider_id: row.provider_id,
      provider_name: extractFullName(row.profiles) ?? 'Unknown',
      content: row.content,
      created_at: row.created_at,
    };
  });
}

/**
 * Get alert preferences for a provider-patient pair.
 * ALRT-07: Mute/unmute alert types
 */
export async function getAlertPreferences(
  supabase: SupabaseClient,
  providerId: string,
  patientId: string
): Promise<Array<{ alert_type: string; muted: boolean }>> {
  const { data, error } = await supabase
    .from('alert_preferences')
    .select('alert_type, muted')
    .eq('provider_id', providerId)
    .eq('patient_id', patientId);

  if (error) throw error;
  return (data ?? []) as Array<{ alert_type: string; muted: boolean }>;
}

/**
 * Batch query for patient no-check-in status.
 * Returns a Map of patient_id -> { lastVitalsAt, createdAt }.
 * ALRT-01: No-check-in detection
 */
export async function getPatientNoCheckinStatus(
  supabase: SupabaseClient,
  patientIds: string[]
): Promise<Map<string, { lastVitalsAt: string | null; createdAt: string }>> {
  const result = new Map<string, { lastVitalsAt: string | null; createdAt: string }>();

  if (patientIds.length === 0) return result;

  // Fetch latest vitals per patient (ordered desc, first per patient is latest)
  const { data: vitals, error: vitalsError } = await supabase
    .from('vitals')
    .select('patient_id, recorded_at')
    .in('patient_id', patientIds)
    .order('recorded_at', { ascending: false });

  if (vitalsError) throw vitalsError;

  // Build lookup: first occurrence per patient_id is the latest
  const latestVitals = new Map<string, string>();
  for (const v of vitals ?? []) {
    if (!latestVitals.has(v.patient_id)) {
      latestVitals.set(v.patient_id, v.recorded_at);
    }
  }

  // Fetch patient created_at
  const { data: patients, error: patientError } = await supabase
    .from('patients')
    .select('id, created_at')
    .in('id', patientIds);

  if (patientError) throw patientError;

  for (const p of patients ?? []) {
    result.set(p.id, {
      lastVitalsAt: latestVitals.get(p.id) ?? null,
      createdAt: p.created_at,
    });
  }

  return result;
}

/**
 * Get vitals history for chart rendering.
 * DASH-03: Vitals trend charts
 */
export async function getPatientVitalsHistory(
  supabase: SupabaseClient,
  patientId: string,
  days: number = 90
): Promise<VitalsChartPoint[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data, error } = await supabase
    .from('vitals')
    .select('recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2')
    .eq('patient_id', patientId)
    .gte('recorded_at', cutoff.toISOString())
    .order('recorded_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((v) => ({
    date: v.recorded_at,
    weight_lbs: v.weight_lbs,
    sbp: v.sbp,
    dbp: v.dbp,
    heart_rate: v.heart_rate,
    spo2: v.spo2,
  }));
}
