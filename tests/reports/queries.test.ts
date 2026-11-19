import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getMonthlyReportData, getNiwTractionStats, getPatientSummaryData } from '@/lib/reports/queries';
import { getReportMedicationLogs, getReportVitals } from '@/lib/reports/export-data';
import { buildMedsCSV } from '@/lib/reports/csv-builders';
import { lastUtcDays } from '@/lib/reports/date-range';
import type { MedicationSchedule } from '@/lib/medications/schedule';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), education: vi.fn(), adherence: vi.fn(), history: vi.fn(), admin: null as unknown }));
vi.mock('@/lib/supabase/admin', () => ({ get supabaseAdmin() { return mocks.admin; } }));
vi.mock('@/lib/dashboard/queries', () => ({ getLinkedPatientProfile: mocks.profile }));
vi.mock('@/lib/education/queries', () => ({ getEducationSummary: mocks.education }));
vi.mock('@/lib/medications/queries', () => ({ getAdherenceForRange: mocks.adherence, getMedicationScheduleHistory: mocks.history }));

const id = (n: number) => '64000000-0000-4000-8000-' + String(n).padStart(12, '0');
const actor = id(1), patient = id(11);
const profile = { id: patient, full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null };
const may = { from: '2025-05-01', to: '2025-05-31' };
type Row = Record<string, string | number | string[] | boolean | null>;
function database(tables: Record<string, Row[]> = {}, failed?: string) {
  const rpc = vi.fn(async () => ({
    data: { actor_id: actor, patient_ids: [patient], snapshot: 'a'.repeat(64), next_cursor: null, items: [] },
    error: failed === 'effective labs' ? { message: 'Private failure' } : null,
  }));
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])], countOnly = false, limit = Infinity;
    const orders: Array<[string, number]> = [];
    const where = (key: string, accept: (v: Row[string]) => boolean) => {
      rows = rows.filter(row => accept(row[key]));
      return query;
    };
    const query = {
      select: (_columns: string, options?: { head: boolean }) => { countOnly = Boolean(options?.head); return query; },
      eq: (key: string, val: string) => where(key, v => v === val),
      not: (key: string, _operator: string, val: null) => where(key, v => v !== val),
      in: (key: string, vals: string[]) => where(key, v => vals.includes(String(v))),
      gte: (key: string, val: string) => where(key, v => String(v) >= val),
      gt: (key: string, val: string) => where(key, v => String(v) > val),
      lt: (key: string, val: string) => where(key, v => String(v) < val),
      lte: (key: string, val: string) => where(key, v => String(v) <= val),
      or: (filter: string) => {
        const patterns = Array.from(filter.matchAll(/content\.ilike\."([^"]+)\*"/g), m => m[1].toLowerCase());
        return where('content', val => patterns.some(prefix => String(val).toLowerCase().startsWith(prefix)));
      },
      order: (key: string, { ascending }: { ascending: boolean }) => { orders.push([key, ascending ? 1 : -1]); return query; },
      limit: (n: number) => { limit = n; return query; },
      then: (resolve: (response: unknown) => void) => {
        if (table === failed) return resolve({ data: null, count: null, error: { message: 'Private failure' } });
        rows.sort((a, b) => {
          for (const [key, order] of orders) {
            const result = String(a[key]).localeCompare(String(b[key]));
            if (result) return order * result;
          }
          return 0;
        });
        return resolve({ data: countOnly ? null : rows.slice(0, limit), count: countOnly ? rows.length : null, error: null });
      },
    };
    return query;
  });
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
}
const vital = (n: number, recorded_at: string) => ({ id: id(n), patient_id: patient, recorded_at, weight_lbs: 120 + n,
  sbp: 110, dbp: 70, heart_rate: 70, spo2: 97 });
const vitals = [
  vital(100, '2025-04-30T23:59:59.999Z'),
  ...[1, 2, 3, 4, 5, 31].map((day, n) => vital(101 + n, `2025-05-${String(day).padStart(2, '0')}T15:00:00.000Z`)),
  vital(110, '2025-06-01T00:00:00.000Z'),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mockResolvedValue(profile);
  mocks.adherence.mockResolvedValue([{ status: 'partial', totalDoses: 2, takenDoses: 1, date: may.to }]);
  mocks.education.mockResolvedValue({ totalDomains: 8, completedDomains: 1, completionRate: 13, domains: [] });
  mocks.history.mockResolvedValue([]);
});

describe('complete calendar-day reports', () => {
  it('includes the entire final UTC day, counts current and historical checklist headers, and excludes the next day', async () => {
    const notes = [
      { content: '[TITRATION CHECKLIST — May 31, 2025]\nReview', created_at: '2025-05-31T15:00:00.000Z' },
      { content: '[Titration] previous format', created_at: '2025-05-01T00:00:00.000Z' },
      { content: 'Unrelated [Titration] mention', created_at: '2025-05-10T00:00:00.000Z' },
      { content: '[Titration] out of range', created_at: '2025-06-01T00:00:00.000Z' },
    ].map((note, n) => ({ ...note, id: id(200+n), patient_id: patient }));
    const alerts = [
      { severity: 'critical', created_at: '2025-05-31T23:59:59.999Z' },
      { severity: 'warning', created_at: '2025-05-01T00:00:00.000Z' },
      { severity: 'critical', created_at: '2025-06-01T00:00:00.000Z' },
    ].map((alert, n) => ({ ...alert, id: id(300+n), patient_id: patient }));
    const { client } = database({ provider_notes: notes, vitals, alerts });
    const summary = await getMonthlyReportData(client, actor, may, [patient]);
    expect(summary).toMatchObject({ totalPatients: 1, activePatientsInPeriod: 1, alertsGenerated: 2,
      alertsCritical: 1, titrationNotesCount: 2, avgCheckInCompliance: 0 });
    await expect(getMonthlyReportData(database({}, 'provider_notes').client, actor, may, [patient])).rejects.toThrow('unavailable');
    expect((await getMonthlyReportData(client, actor, may, [])).avgCheckInCompliance).toBeNull();
    expect((await getMonthlyReportData(client, actor, { from: may.to, to: may.to }, [patient])).avgCheckInCompliance).toBeNull();
  });

  it('uses five latest measurements from the requested period even for dates far outside the dashboard lookback', async () => {
    const { client, rpc } = database({ vitals });
    const summary = await getPatientSummaryData(client, patient, actor, may);
    const csv = await getReportVitals(client, [patient], may);
    expect(summary?.vitals.map(v => v.date)).toEqual(csv.slice(0, 5).map(v => v.recorded_at));
    expect(csv).toHaveLength(6);
    expect(summary?.vitals[0].date).toBe('2025-05-31T15:00:00.000Z');
    expect(mocks.profile).toHaveBeenCalledWith(client, actor, patient);
    expect(mocks.adherence).toHaveBeenCalledWith(client, patient, may.from, may.to);
    expect(summary?.educationProgress?.completedDomains).toBe(1);
    expect(rpc).toHaveBeenCalledWith('get_effective_lab_observations', {
      p_patient_ids: [patient], p_after: null, p_snapshot: null,
    });
  });

  it('stops before source reads for an unlinked profile and propagates unavailable source reads', async () => {
    const db = database({}, 'effective labs');
    mocks.profile.mockResolvedValueOnce(null);
    await expect(getPatientSummaryData(db.client, patient, actor, may)).resolves.toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    await expect(getPatientSummaryData(db.client, patient, actor, may)).rejects.toThrow('could not be verified');
    mocks.education.mockRejectedValueOnce(new Error('private'));
    expect((await getPatientSummaryData(database().client, patient, actor, may))?.educationProgress).toBeNull();
  });

  it('keeps dose logs without a taken timestamp and reports the dose recorded for that date', async () => {
    const med = id(80);
    const plan = { id: id(81), medication_id: med, patient_id: patient, known: true, active: true,
      starts_on: may.from, ends_before: '2025-05-15', name: 'Synthetic tablet', dosage: 'recorded dose A',
      frequency: 'weekly', timing: null, weekly_day: 5 } satisfies MedicationSchedule;
    mocks.history.mockResolvedValue([plan, { ...plan, id: id(82), starts_on: '2025-05-15', ends_before: null, dosage: 'recorded dose B' }]);
    const logs = ['2025-05-02', '2025-05-31', '2025-06-01'].map((day, i) => ({
      id: id(200+i), patient_id: patient, medication_id: med, scheduled_date: day, dose_number: 1,
      taken_at: i===1 ? null : day+'T12:00:00.000Z', taken: i!==1,
    }));
    const data = await getReportMedicationLogs(database({ medication_logs: logs }).client, [patient], may);
    expect(data.map(d => [d.scheduled_date, d.dose, d.taken_at])).toEqual([
      ['2025-05-31', 'recorded dose B', null], ['2025-05-02', 'recorded dose A', '2025-05-02T12:00:00.000Z'],
    ]);
    const reduced = buildMedsCSV(data, { deidentify: true, patientMap: new Map([[patient, 'P001']]) });
    expect(reduced[1]).toEqual([
      'P001', 'Synthetic tablet', 'recorded dose B', 'weekly', '', 'false', '2025', '1', 'recorded', '', 'unrecorded',
    ]);
  });

  it('reads more than one REST page without losing the final record, and counts exact preset day spans', async () => {
    const rows = Array.from({ length: 251 }, (_, n) => vital(1000+n, '2025-05-31T23:59:59.999Z'));
    const db = database({ vitals: rows });
    expect(await getReportVitals(db.client, [patient], may)).toHaveLength(251);
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(lastUtcDays(30, new Date('2026-11-30T00:05:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('aggregated dissemination evidence', () => {
  const adoption = { active_sandbox_accounts: 0, unique_sandbox_testers: 2, sandbox_views: 4, sandbox_first_actions: 1,
    sandbox_task_completions: 1, median_session_duration_ms: 0, campaign_sources: { synthetic: 2 } };
  it('counts profiles and reviewed access requests separately and preserves real zero values', async () => {
    const db = database({
      profiles: [
        { id: id(1), created_at: '2026-02-01T10:00:00Z', role: 'provider', state: 'Utah' },
        { id: id(2), created_at: '2026-02-01T10:30:00Z', role: 'patient', state: null },
        { id: id(3), created_at: '2026-02-01T11:00:00Z', role: 'tester', state: 'Ohio' },
      ],
      access_requests: [{ id: id(4), status: 'pending' }],
    });
    mocks.admin = { from: db.from, rpc: () => Promise.resolve({ data: adoption, error: null }) };
    expect(await getNiwTractionStats()).toMatchObject({ totalProviders: 1, totalPatients: 1,
      totalAlerts: 0, totalTitrations: 0, approvedAccessRequests: 0, pendingAccessRequests: 1,
      activeStates: ['Utah'], activeSandboxAccounts: 0, sandboxActivationRate30d: 50, medianSandboxDurationSeconds: null });
  });
  it('unifies canonical codes and historical names, including territories, and excludes unrecognized entries', async () => {
    const db = database({ profiles: ['CA', 'California', 'Historic free-text entry', 'PR'].map((state, i) => ({
      id: id(i + 1), role: 'patient', created_at: '2026-02-01T10:00:00Z', state,
    })) });
    mocks.admin = { from: db.from, rpc: () => Promise.resolve({ data: adoption, error: null }) };
    expect((await getNiwTractionStats()).activeStates).toEqual(['California', 'Puerto Rico']);
  });
  it('retains a recorded zero-millisecond duration', async () => {
    const db = database({ product_events: [{ id: id(4), actor_role: 'tester', event_name: 'sandbox_view',
      duration_ms: 0, occurred_at: new Date().toISOString() }] });
    mocks.admin = { from: db.from, rpc: () => Promise.resolve({ data: adoption, error: null }) };
    expect((await getNiwTractionStats()).medianSandboxDurationSeconds).toBe(0);
  });
  it('raises an unavailable source or incomplete aggregate instead of issuing a report with zeroes', async () => {
    mocks.admin = { from: database({}, 'alerts').from, rpc: () => Promise.resolve({ data: adoption, error: null }) };
    await expect(getNiwTractionStats()).rejects.toThrow('unavailable');
    mocks.admin = { from: database().from, rpc: () => Promise.resolve({ data: {}, error: null }) };
    await expect(getNiwTractionStats()).rejects.toThrow();
  });
});
