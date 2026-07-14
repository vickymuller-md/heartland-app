/**
 * HEARTLAND Provider Dashboard -- Metrics Query Functions
 *
 * All functions accept a SupabaseClient parameter for testability.
 * Follows batch patientIds pattern from getLinkedPatients (no N+1 queries).
 *
 * Requirements: METR-01 through METR-04
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { startOfMonth, format, parseISO, subWeeks, startOfWeek } from 'date-fns';
import { extractFullName } from '@/lib/supabase/types';
import type {
  ProviderMetrics,
  MetricTrend,
  RpmDataCompletenessPatient,
} from './metrics-types';
import { EMPTY_METRICS } from './metrics-types';
import {
  RPM_CPT_99454_THRESHOLD,
  GDMT_CLASS_KEYWORDS,
} from './metrics-constants';

// ---------- Pure Functions ----------

/**
 * Classify a medication name into a GDMT drug class.
 * Case-insensitive keyword matching against GDMT_CLASS_KEYWORDS.
 * Returns null if no class matches.
 *
 * METR-02
 */
export function classifyGdmt(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [cls, keywords] of Object.entries(GDMT_CLASS_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return cls;
  }
  return null;
}

/**
 * Compute GDMT optimization rate for HFrEF patients.
 * A patient is "optimized" if they are on medications from >= 3 of the 4 drug classes.
 *
 * Returns { rate: 0, classifiedCount: 0, hfrefCount: 0 } when no HFrEF patients exist.
 *
 * METR-02
 */
export function computeGdmtRate(
  hfrefPatientIds: string[],
  medications: Array<{ patient_id: string; name: string }>
): { rate: number; classifiedCount: number; hfrefCount: number } {
  if (hfrefPatientIds.length === 0) {
    return { rate: 0, classifiedCount: 0, hfrefCount: 0 };
  }

  const hfrefSet = new Set(hfrefPatientIds);

  // Group medication classes by patient
  const classesByPatient = new Map<string, Set<string>>();
  for (const med of medications) {
    if (!hfrefSet.has(med.patient_id)) continue;
    const cls = classifyGdmt(med.name);
    if (cls) {
      const set = classesByPatient.get(med.patient_id) ?? new Set();
      set.add(cls);
      classesByPatient.set(med.patient_id, set);
    }
  }

  // Count patients with >= 3 classes
  let classifiedCount = 0;
  for (const classes of classesByPatient.values()) {
    if (classes.size >= 3) classifiedCount++;
  }

  const rate = Math.round((classifiedCount / hfrefPatientIds.length) * 100);
  return { rate, classifiedCount, hfrefCount: hfrefPatientIds.length };
}

/**
 * Compute weekly trend data for sparkline charts.
 * Bins raw data points into weekly buckets for the last N weeks.
 *
 * @param rawData - Array of { recorded_at: string; value: number }
 * @param metricFn - Aggregation function: 'count' | 'average'
 * @param weeksBack - Number of weeks to look back (default 6)
 *
 * METR-04
 */
export function computeWeeklyTrend(
  rawData: Array<{ recorded_at: string; value: number }>,
  metricFn: 'count' | 'average' = 'count',
  weeksBack: number = 6
): MetricTrend[] {
  const now = new Date();
  const trends: MetricTrend[] = [];

  for (let i = weeksBack - 1; i >= 0; i--) {
    const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
    const weekEnd = startOfWeek(subWeeks(now, i - 1), { weekStartsOn: 1 });
    const weekLabel = `W${weeksBack - i}`;

    const inWeek = rawData.filter((d) => {
      const date = parseISO(d.recorded_at);
      return date >= weekStart && date < weekEnd;
    });

    let value = 0;
    if (metricFn === 'count') {
      value = inWeek.length;
    } else if (metricFn === 'average' && inWeek.length > 0) {
      value = Math.round(
        inWeek.reduce((sum, d) => sum + d.value, 0) / inWeek.length
      );
    }

    trends.push({ week: weekLabel, value });
  }

  return trends;
}

// ---------- Async Query Functions ----------

/**
 * Get patients eligible for RPM billing under CPT 99454.
 * Counts distinct calendar dates (UTC) with vitals this month per patient.
 * Returns patients with >= RPM_CPT_99454_THRESHOLD (16) days.
 *
 * METR-03
 */
export async function getRpmDataCompletenessPatients(
  supabase: SupabaseClient,
  patientIds: string[]
): Promise<RpmDataCompletenessPatient[]> {
  if (patientIds.length === 0) return [];

  const monthStart = startOfMonth(new Date());

  // Fetch all vitals for this month in one batch query
  const { data: monthVitals, error } = await supabase
    .from('vitals')
    .select('patient_id, recorded_at')
    .in('patient_id', patientIds)
    .gte('recorded_at', monthStart.toISOString());

  if (error) throw error;

  // Count distinct dates per patient
  const daysByPatient = new Map<string, Set<string>>();
  for (const v of monthVitals ?? []) {
    const dateKey = format(parseISO(v.recorded_at), 'yyyy-MM-dd');
    const set = daysByPatient.get(v.patient_id) ?? new Set();
    set.add(dateKey);
    daysByPatient.set(v.patient_id, set);
  }

  // Product completeness marker only; not billing eligibility.
  const completeIds = patientIds.filter(
    (id) => (daysByPatient.get(id)?.size ?? 0) >= RPM_CPT_99454_THRESHOLD
  );

  if (completeIds.length === 0) return [];

  // Fetch names for patients meeting the product marker.
  const { data: patients, error: nameError } = await supabase
    .from('patients')
    .select('id, profiles(full_name)')
    .in('id', completeIds);

  if (nameError) throw nameError;

  return (patients ?? []).map((p) => {
    return {
      id: p.id,
      full_name: extractFullName(p.profiles) ?? 'Unknown',
      vitals_days_this_month: daysByPatient.get(p.id)?.size ?? 0,
    };
  });
}

/**
 * Get all provider metrics in a single call.
 * Orchestrates sub-queries using Promise.all for parallel execution.
 *
 * METR-01
 */
export async function getProviderMetrics(
  supabase: SupabaseClient,
  providerId: string
): Promise<ProviderMetrics> {
  // Step 1: Get active patient links
  const { data: links, error: linkError } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  if (linkError) throw linkError;
  if (!links || links.length === 0) return EMPTY_METRICS;

  const patientIds = links.map((l) => l.patient_id);
  const totalPatients = patientIds.length;

  // Step 2: Run 4 independent queries in parallel
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [alertResult, vitalsResult, medsResult, hfrefResult] =
    await Promise.all([
      // a. Active alerts count
      supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .in('patient_id', patientIds)
        .eq('status', 'open'),

      // b. Recent vitals (last 3 days) for no-checkin count
      supabase
        .from('vitals')
        .select('patient_id')
        .in('patient_id', patientIds)
        .gte('recorded_at', threeDaysAgo.toISOString()),

      // c. Medication logs (last 7 days) for adherence
      supabase
        .from('medication_logs')
        .select('medication_id, patient_id, taken')
        .in('patient_id', patientIds)
        .gte('logged_at', sevenDaysAgo.toISOString()),

      // d. HFrEF patients and their medications for GDMT rate
      supabase
        .from('patients')
        .select('id')
        .in('id', patientIds)
        .eq('hf_type', 'HFrEF'),
    ]);

  // activeAlerts
  const activeAlerts = alertResult.count ?? 0;

  // noCheckinCount
  const recentPatientSet = new Set(
    (vitalsResult.data ?? []).map((v) => v.patient_id)
  );
  const noCheckinCount = patientIds.filter(
    (id) => !recentPatientSet.has(id)
  ).length;

  // avgAdherence: logs taken / (distinct medications * 7 days)
  let avgAdherence = 0;
  const logs = medsResult.data ?? [];
  if (logs.length > 0) {
    const distinctMeds = new Set(logs.map((l) => l.medication_id));
    const logsTaken = logs.filter((l) => l.taken).length;
    const expected = distinctMeds.size * 7;
    avgAdherence = expected > 0 ? Math.round((logsTaken / expected) * 100) : 0;
    avgAdherence = Math.min(100, Math.max(0, avgAdherence));
  }

  // GDMT optimization rate
  const hfrefPatientIds = (hfrefResult.data ?? []).map((p) => p.id);
  let gdmtOptRate = 0;

  if (hfrefPatientIds.length > 0) {
    // Fetch medications for HFrEF patients
    const { data: hfrefMeds } = await supabase
      .from('medications')
      .select('patient_id, name')
      .in('patient_id', hfrefPatientIds);

    const gdmtResult = computeGdmtRate(hfrefPatientIds, hfrefMeds ?? []);
    gdmtOptRate = gdmtResult.rate;
  }

  // App-entry completeness marker; not a billing eligibility determination.
  const rpmReady = await getRpmDataCompletenessPatients(supabase, patientIds);
  const rpmDataCompletenessCount = rpmReady.length;

  return {
    totalPatients,
    activeAlerts,
    noCheckinCount,
    avgAdherence,
    rpmDataCompletenessCount,
    gdmtOptRate,
  };
}
