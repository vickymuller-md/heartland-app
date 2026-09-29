// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), authorize: vi.fn(), analytics: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: mocks.authorize }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: mocks.analytics }));
import { GET } from '@/app/api/patients/[patientId]/fhir/route';

const id = (n: number) => '67000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const actor = id(1), patientId = id(2);
const auth = () => ({ authorized: true, supabase: { from: mocks.from, rpc: mocks.rpc }, user: { id: actor }, role: 'provider' });
const vital = (n: number) => ({ id: id(n), patient_id: patientId, recorded_at: '2026-09-28T12:00:00Z',
  weight_lbs: null, sbp: null, dbp: null, heart_rate: 68, spo2: null });
const medication = (n: number) => ({ id: id(n), patient_id: patientId, name: 'Synthetic medication',
  dosage: null, frequency: null, timing: null, active: true });
const lab = (n: number): EffectiveLabObservation => ({
  id: id(n) + ':potassium', patient_id: patientId, original_lab_result_id: id(n), analyte: 'potassium',
  root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: id(n),
  value: '4.20000000000000001', collected_at: '2026-09-28T12:00:00.000001Z',
  notes: null, lab_facility: null, evaluation_status: 'pending',
});
let rows: { vitals: ReturnType<typeof vital>[]; medications: ReturnType<typeof medication>[] };
let labs: EffectiveLabObservation[];
let profile: { data: { id: string; full_name: string | null; patient_code: string | null } | null; error: unknown };
let pageError: string | null;
let pageCalls: Record<string, number>;
let calls: string[];
const selections: { table: string; columns: string }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); pageError = null; pageCalls = {}; calls = []; selections.length = 0;
  rows = { vitals: [vital(10)], medications: [medication(20)] }; labs = [lab(30)];
  profile = { data: { id: patientId, full_name: 'Synthetic Person', patient_code: 'SYN001' }, error: null };
  mocks.authorize.mockReset().mockImplementation(async () => { calls.push('auth'); return auth(); });
  mocks.analytics.mockReset().mockImplementation(async () => { calls.push('analytics'); });
  mocks.audit.mockReset().mockImplementation(async () => { calls.push('audit'); return { error: null }; });
  mocks.from.mockImplementation((table: string) => {
    if (table === 'data_export_events') return { insert: mocks.audit };
    if (!['profiles', 'vitals', 'medications'].includes(table)) throw new Error('Unexpected raw table');
    let after: string | null = null;
    const query = {
      select: (columns: string) => { selections.push({ table, columns }); return query; },
      eq: (field: string, value: string) => { expect(value).toBe(patientId); expect(field).toBe(table === 'profiles' ? 'id' : 'patient_id'); return query; },
      order: (field: string, options: unknown) => { expect(field).toBe('id'); expect(options).toEqual({ ascending: true }); return query; },
      limit: (size: number) => { expect(size).toBe(250); return query; },
      gt: (field: string, value: string) => { expect(field).toBe('id'); after = value; return query; },
      single: async () => profile,
      then: (resolve: (value: unknown) => unknown) => {
        pageCalls[table] = (pageCalls[table] ?? 0) + 1; calls.push(table + ':' + pageCalls[table]);
        const data = rows[table as keyof typeof rows].filter((row) => after === null || row.id > after).slice(0, 250);
        return Promise.resolve({ data, error: pageError === table + ':' + pageCalls[table] ? new Error('Private database details') : null }).then(resolve);
      },
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: { p_after: string | null; p_snapshot: string | null; p_patient_ids: string[] }) => {
    expect(name).toBe('get_effective_lab_observations'); expect(args.p_patient_ids).toEqual([patientId]);
    pageCalls.labs = (pageCalls.labs ?? 0) + 1;
    const remaining = labs.filter((row) => args.p_after === null || row.id > args.p_after);
    const items = remaining.slice(0, 250);
    return { data: { actor_id: actor, patient_ids: [patientId], snapshot: 'a'.repeat(64), items,
      next_cursor: remaining.length > 250 ? items.at(-1)!.id : null },
    error: pageError === 'labs:' + pageCalls.labs ? new Error('Private laboratory details') : null };
  });
});
afterEach(() => vi.useRealTimers());
async function get(expectedActor: string | null = actor) {
  return GET(new Request('https://app.heartlandprotocol.org/api/patients/' + patientId + '/fhir',
    { headers: expectedActor === null ? {} : { 'X-Heartland-Expected-Actor': expectedActor } }),
  { params: Promise.resolve({ patientId }) });
}
describe('FHIR route complete read and authorization', () => {
  it('returns decimal-safe bytes after mandatory preparation audit and final authorization', async () => {
    const response = await get(); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).toContain('"value":4.20000000000000001');
    expect(text).toContain('2026-09-28T12:00:00.000001Z');
    expect(response.headers.get('Content-Type')).toContain('application/fhir+json');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Heartland-Export-Actor')).toBe(actor);
    expect(response.headers.get('X-Heartland-Export-Patient')).toBe(patientId);
    expect(response.headers.get('Content-Disposition')).toMatch(/attachment; filename="heartland-fhir-r4-.*\.json"/);
    expect(mocks.audit).toHaveBeenCalledWith({ provider_id: actor, patient_id: patientId, format: 'fhir-r4-json', resource_count: 4 });
    expect(calls.slice(-3)).toEqual(['audit', 'analytics', 'auth']);
    expect(selections.filter((item) => item.table !== 'profiles').every((item) => item.columns.includes('patient_id'))).toBe(true);
    expect(mocks.from).not.toHaveBeenCalledWith('lab_results');
  });
  it('reads251 rows in each family, without the old100-row truncation', async () => {
    rows.vitals = Array.from({ length: 251 }, (_, i) => vital(i + 100));
    rows.medications = Array.from({ length: 251 }, (_, i) => medication(i + 1000));
    labs = Array.from({ length: 251 }, (_, i) => lab(i + 2000));
    const response = await get(); expect(response.status).toBe(200);
    const bundle = await response.json(); expect(bundle.entry).toHaveLength(754);
    expect(pageCalls).toEqual({ vitals: 2, medications: 2, labs: 2 });
  });
  it.each(['vitals:2', 'medications:2', 'labs:2'])('discards all data when later page %s fails', async (failure) => {
    rows.vitals = Array.from({ length: 251 }, (_, i) => vital(i + 100));
    rows.medications = Array.from({ length: 251 }, (_, i) => medication(i + 1000));
    labs = Array.from({ length: 251 }, (_, i) => lab(i + 2000)); pageError = failure;
    const response = await get(); expect(response.status).toBe(500);
    expect(await response.text()).not.toMatch(/Synthetic Person|4\.200|Private/);
    expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(['profile-missing', 'profile-error', 'profile-scope', 'vital-scope', 'medication-scope', 'lab-scope', 'vital-duplicate', 'medication-duplicate', 'invalid-value'])('fails closed for %s', async (kind) => {
    if (kind === 'profile-missing') profile.data = null;
    if (kind === 'profile-error') profile.error = new Error('Private error');
    if (kind === 'profile-scope') profile.data!.id = id(99);
    if (kind === 'vital-scope') rows.vitals[0].patient_id = id(99);
    if (kind === 'medication-scope') rows.medications[0].patient_id = id(99);
    if (kind === 'lab-scope') labs[0].patient_id = id(99);
    if (kind === 'vital-duplicate') rows.vitals.push(vital(10));
    if (kind === 'medication-duplicate') rows.medications.push(medication(20));
    if (kind === 'invalid-value') labs[0].value = 'NaN';
    const response = await get(); expect(response.status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled(); expect(await response.text()).not.toMatch(/Synthetic Person|Private/);
  });
  it('does not turn an empty successful source read into unavailability', async () => {
    rows = { vitals: [], medications: [] }; labs = [];
    const response = await get(); expect(response.status).toBe(200);
    expect((await response.json()).entry).toHaveLength(1);
  });
  it.each([null, 'not-a-guid', id(99)])('refuses missing/invalid/mismatched expected actor %s before patient reads', async (actorHeader) => {
    const response = await get(actorHeader); expect([400, 403]).toContain(response.status);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['Not authenticated', 'Unauthorized', 'Consent required', 'MFA required'])('refuses initial %s without reads or cacheable data', async (error) => {
    mocks.authorize.mockResolvedValueOnce({ authorized: false, error });
    const response = await get(); expect(response.status).toBe(error === 'Not authenticated' ? 401 : 403);
    expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['denied', 'account-change'])('refuses final %s even after preparation was audited', async (kind) => {
    mocks.authorize.mockResolvedValueOnce(auth()).mockResolvedValueOnce(kind === 'denied'
      ? { authorized: false, error: 'Consent required' } : { ...auth(), user: { id: id(99) } });
    const response = await get(); expect(response.status).toBe(403);
    expect(mocks.audit).toHaveBeenCalledOnce(); expect(await response.text()).not.toContain('Synthetic Person');
  });
  it('requires a successful audit before response and never relies on analytics as its receipt', async () => {
    mocks.audit.mockResolvedValue({ error: new Error('Private audit error') });
    const response = await get(); expect(response.status).toBe(500);
    expect(mocks.analytics).not.toHaveBeenCalled(); expect(await response.text()).not.toContain('Private');
  });
  it('assesses quality after the read, not at request start', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    labs[0].collected_at = '2026-09-29T12:00:01Z';
    const implementation = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (...args) => {
      const result = await implementation(...args); vi.setSystemTime(new Date('2026-09-29T12:00:02Z')); return result;
    });
    const response = await get(); expect(response.status).toBe(200);
    const text = await response.text(); expect(text).toContain('"value":4.20000000000000001'); expect(text).not.toContain('Future collection');
  });
  it('returns explicit413 above the audit limit before audit, with no partial bundle', async () => {
    rows.vitals = []; labs = [];
    rows.medications = Array.from({ length: 10000 }, (_, i) => medication(i + 100));
    const response = await get(); expect(response.status).toBe(413);
    expect(await response.text()).toContain('10,000-resource limit');
    expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
