import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getLinkedPatientIds } from '@/lib/supabase/linked-patients';
import { findUsRegion } from '@/lib/us-regions';
import { getAdherenceForRange } from '@/lib/medications/queries';
import { getEducationSummary } from '@/lib/education/queries';
import { getLinkedPatientProfile } from '@/lib/dashboard/queries';
import { getReportLabResults } from './lab-results';
import { reportDateBounds } from './date-range';
import { exactCount, readReportRows } from './rows';
import type { MonthlyCount, MonthlyReportData, NiwTractionData, PatientSummaryData, ReportDateRange } from './types';

export type { MonthlyReportData, PatientSummaryData, NiwTractionData, MonthlyCount } from './types';

// The report counts saved checklist headers, including the historical spelling.
export const TITRATION_NOTE_FILTER = 'content.ilike."[TITRATION CHECKLIST — *",content.ilike."[Titration]*"';

export { getLinkedPatientIds as getReportPatientIds };

export async function getReportPatients(client: SupabaseClient, patientIds: string[]) {
  const patients: Array<{ id: string; full_name: string }> = [];
  for (let i = 0; i < patientIds.length; i += 100) {
    const scope = patientIds.slice(i, i + 100);
    const { data, error } = await client.from('profiles').select('id, full_name').in('id', scope);
    if (error || !data || data.length !== scope.length) throw new Error('Panel unavailable.');
    patients.push(...data.map(p => ({ id: p.id, full_name: p.full_name ?? 'Name not recorded' })));
  }
  return patients.sort((a, b) => a.full_name.localeCompare(b.full_name) || a.id.localeCompare(b.id));
}

export async function getMonthlyReportData(
  client: SupabaseClient, providerId: string, range: ReportDateRange,
  linkedIds?: string[],
): Promise<MonthlyReportData> {
  const { fromInclusive, toExclusive } = reportDateBounds(range);
  const patientIds = linkedIds ?? await getLinkedPatientIds(client, providerId);
  const daysPerPatient = new Map<string, Set<string>>();
  let alertsGenerated = 0, alertsCritical = 0, titrationNotesCount = 0;
  for (let i = 0; i < patientIds.length; i += 100) {
    const scope = patientIds.slice(i, i + 100);
    const alerts = () => client.from('alerts').select('id', { count: 'exact', head: true })
      .in('patient_id', scope).gte('created_at', fromInclusive).lt('created_at', toExclusive);
    const [vitals, total, critical, notes] = await Promise.all([
      readReportRows(() => client.from('vitals').select('id, patient_id, recorded_at')
        .in('patient_id', scope).gte('recorded_at', fromInclusive).lt('recorded_at', toExclusive)),
      alerts(),
      alerts().eq('severity', 'critical'),
      client.from('provider_notes').select('id', { count: 'exact', head: true })
        .in('patient_id', scope).or(TITRATION_NOTE_FILTER)
        .gte('created_at', fromInclusive).lt('created_at', toExclusive),
    ]);
    for (const vital of vitals) {
      const dates = daysPerPatient.get(vital.patient_id) ?? new Set<string>();
      dates.add(new Date(vital.recorded_at).toISOString().slice(0, 10));
      daysPerPatient.set(vital.patient_id, dates);
    }
    alertsGenerated += exactCount(total);
    alertsCritical += exactCount(critical);
    titrationNotesCount += exactCount(notes);
  }
  const daysInPeriod = (Date.parse(toExclusive) - Date.parse(fromInclusive)) / 86_400_000;
  const withSixteenDays = [...daysPerPatient.values()].filter(days => days.size >= 16).length;
  return {
    month: range.from.slice(0, 7), ...range, totalPatients: patientIds.length,
    activePatientsInPeriod: daysPerPatient.size, alertsGenerated, alertsCritical, titrationNotesCount,
    avgCheckInCompliance: patientIds.length && daysInPeriod >= 16
      ? Math.round(withSixteenDays * 1000 / patientIds.length) / 10 : null,
    gdmtOptimizationRate: null,
  };
}

export async function getPatientSummaryData(
  client: SupabaseClient, patientId: string, providerId: string, range: ReportDateRange,
): Promise<PatientSummaryData | null> {
  const { fromInclusive, toExclusive } = reportDateBounds(range);
  const patient = await getLinkedPatientProfile(client, providerId, patientId);
  if (!patient) return null;
  const [vitals, notes, openAlerts, adherenceSummary, educationProgress, labs] = await Promise.all([
    client.from('vitals').select('recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2').eq('patient_id', patientId)
      .gte('recorded_at', fromInclusive).lt('recorded_at', toExclusive)
      .order('recorded_at', { ascending: false }).order('id', { ascending: true }).limit(5),
    client.from('provider_notes').select('id, content, created_at').eq('patient_id', patientId)
      .gte('created_at', fromInclusive).lt('created_at', toExclusive)
      .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(3),
    readReportRows(() => client.from('alerts').select('id, severity, flags, created_at')
      .eq('patient_id', patientId).in('status', ['open', 'acknowledged'])),
    getAdherenceForRange(client, patientId, range.from, range.to).catch(() => null),
    getEducationSummary(client, patientId).catch(() => null),
    getReportLabResults(client, [patientId], range, providerId),
  ]);
  if (vitals.error || !vitals.data || notes.error || !notes.data) throw new Error('Summary source unavailable.');
  return {
    patient, dateRange: range, labs, notes: notes.data, adherenceSummary, educationProgress,
    vitals: vitals.data.map(({ recorded_at, ...values }) => ({ date: recorded_at, ...values })),
    openAlerts: openAlerts.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)),
  };
}

export function computeMonthlyGrowth(
  providerRows: { created_at: string }[], patientRows: { created_at: string }[], now = new Date(),
): MonthlyCount[] {
  const months: MonthlyCount[] = [];
  for (let i = 11; i >= 0; i--) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    months.push({ month,
      providers: providerRows.filter(r => r.created_at.slice(0, 7) === month).length,
      patients: patientRows.filter(r => r.created_at.slice(0, 7) === month).length,
    });
  }
  return months;
}

const count = z.number().int().nonnegative();
const adoptionSchema = z.object({
  active_sandbox_accounts: count, unique_sandbox_testers: count, sandbox_views: count,
  sandbox_first_actions: count, sandbox_task_completions: count,
  median_session_duration_ms: z.number().nonnegative(), campaign_sources: z.record(z.string(), count),
});

/** Aggregate only. An unavailable source prevents printing a misleading evidence report. */
export async function getNiwTractionStats(): Promise<NiwTractionData> {
  const { supabaseAdmin: db } = await import('@/lib/supabase/admin');
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [profiles, alerts, notes, approved, pending, adoption] = await Promise.all([
    readReportRows(() => db.from('profiles').select('id, role, created_at, state').in('role', ['provider', 'patient'])),
    db.from('alerts').select('id', { count: 'exact', head: true }),
    db.from('provider_notes').select('id', { count: 'exact', head: true }).or(TITRATION_NOTE_FILTER),
    db.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    db.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.rpc('get_adoption_summary', { p_since: since }),
  ]);
  if (adoption.error) throw new Error('Dissemination summary unavailable.');
  const metrics = adoptionSchema.parse(adoption.data);
  // The aggregate returns zero for both an empty sample and measured zero milliseconds.
  let medianDuration: number | null = Math.round(metrics.median_session_duration_ms / 1000);
  if (metrics.median_session_duration_ms === 0) {
    const sample = await db.from('product_events').select('id', { count: 'exact', head: true })
      .eq('actor_role', 'tester').eq('event_name', 'sandbox_view').gte('occurred_at', since)
      .not('duration_ms', 'is', null);
    if (exactCount(sample) === 0) medianDuration = null;
  }
  const providers = profiles.filter(p => p.role === 'provider');
  const patients = profiles.filter(p => p.role === 'patient');
  const names = profiles.flatMap(profile => {
    const region = findUsRegion(profile.state);
    return region ? [region.name] : [];
  });
  return {
    totalProviders: providers.length, totalPatients: patients.length,
    activeStates: [...new Set(names)].sort(),
    monthlyGrowth: computeMonthlyGrowth(providers, patients, now),
    totalAlerts: exactCount(alerts), totalTitrations: exactCount(notes),
    approvedAccessRequests: exactCount(approved), pendingAccessRequests: exactCount(pending),
    activeSandboxAccounts: metrics.active_sandbox_accounts, uniqueSandboxTesters30d: metrics.unique_sandbox_testers,
    sandboxViews30d: metrics.sandbox_views, sandboxFirstActions30d: metrics.sandbox_first_actions,
    sandboxTaskCompletions30d: metrics.sandbox_task_completions,
    sandboxActivationRate30d: metrics.unique_sandbox_testers
      ? Math.round(metrics.sandbox_first_actions * 100 / metrics.unique_sandbox_testers) : null,
    medianSandboxDurationSeconds: medianDuration,
    campaignSources30d: Object.entries(metrics.campaign_sources).map(([source, sessions]) => ({ source, sessions }))
      .sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source)),
  };
}
