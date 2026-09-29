import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { losslessLabNumber, selectChecklistLabs, readPatientDirectory, readPatientSelection } from '@/lib/integration/patient-selection';
import type { EffectiveLabObservation } from '@/lib/labs/effective';
const id = (n: number) => '69000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const actor = id(1), patientId = id(2);
const patient = { id: patientId, full_name: 'Synthetic Patient', email: null, phone: null, patient_code: null, risk_tier: null };
const source = (n = 10, patch: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation => ({
  id: id(n) + ':potassium', patient_id: patientId, original_lab_result_id: id(n), analyte: 'potassium',
  root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: id(n),
  value: '4.200', collected_at: '2026-09-20T12:00:00.000001Z', notes: 'Not copied into snapshot', lab_facility: 'Synthetic', evaluation_status: 'pending', ...patch,
});
const vital = { id: id(5), patient_id: patientId, weight_lbs: null, sbp: 120, dbp: 70, heart_rate: 65, spo2: 97, recorded_at: '2026-09-28T12:00:00Z' };
const medication = (n: number) => ({ id: id(n), patient_id: patientId, name: 'Synthetic medication', dosage: '10mg', frequency: 'daily' });
let rows: Record<string, Record<string, unknown>[]>;
let laboratories: EffectiveLabObservation[];
let failure: string | null;
let calls: Record<string, number>;
let from: ReturnType<typeof vi.fn>;
let getUser: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let client: SupabaseClient;
beforeEach(() => {
  rows = { provider_patient_links: [{ id: id(3), provider_id: actor, patient_id: patientId }],
    profiles: [{ id: patientId, full_name: patient.full_name, email: null, phone: null, patient_code: null }],
    patients: [{ id: patientId, risk_tier: null }], vitals: [vital], medications: [medication(6)] };
  laboratories = [source()]; failure = null; calls = {};
  getUser = vi.fn(async () => ({ data: { user: { id: actor } }, error: null }));
  from = vi.fn((table: string) => {
    if (table === 'lab_results') throw new Error('No raw laboratory fallback');
    let selected = rows[table]; let limit = 250;
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { if (key !== 'active' && key !== 'status') selected = selected.filter((row) => row[key] === value); return query; },
      in: (key: string, values: string[]) => { selected = selected.filter((row) => values.includes(row[key] as string)); return query; },
      gt: (key: string, value: string) => { selected = selected.filter((row) => (row[key] as string) > value); return query; },
      order: () => query, limit: (value: number) => { limit = value; return query; },
      maybeSingle: async () => ({ data: selected[0] ? { id: selected[0].id } : null, error: failure === 'link' ? new Error('Private') : null }),
      then: (resolve: (result: unknown) => unknown) => {
        calls[table] = (calls[table] ?? 0) + 1;
        return Promise.resolve({ data: selected.slice(0, limit), error: failure === table + ':' + calls[table] ? new Error('Private') : null }).then(resolve);
      },
    };
    return query;
  });
  rpc = vi.fn(async (name: string, args: { p_after: string | null }) => {
    if (name === 'provider_aal2' || name === 'provider_has_patient') return { data: failure !== 'link', error: null };
    calls.labs = (calls.labs ?? 0) + 1;
    const remaining = laboratories.filter((lab) => !args.p_after || lab.id > args.p_after);
    const items = remaining.slice(0, 250);
    return { data: { actor_id: actor, patient_ids: [patientId], snapshot: 'a'.repeat(64), items,
      next_cursor: remaining.length > 250 ? items.at(-1)!.id : null }, error: failure === 'labs:' + calls.labs ? new Error('Private') : null };
  });
  client = { auth: { getUser }, from, rpc } as unknown as SupabaseClient;
});
describe('lossless checklist numeric prefill', () => {
  it.each(['4.200', '0004.200', '0.0000001', '1000000000000000000000', '-0.000', '0'])('admits a canonical exact roundtrip for %s', (value) => {
    expect(losslessLabNumber(value)).toBe(Number(value));
  });
  it.each(['4.20000000000000001', '9007199254740993', '0.' + '0'.repeat(330) + '1', '9'.repeat(330), '-4', 'NaN', '1e3', ''])('withholds %s instead of rounding', (value) => {
    expect(losslessLabNumber(value)).toBeNull();
  });
  it('selects separate analytes and collection instants, not the latest panel', () => {
    const labs = [source(), source(11, { id: id(11) + ':creatinine', analyte: 'creatinine', value: '1.10', collected_at: '2026-09-19T12:00:00Z' }),
      source(12, { id: id(12) + ':sodium', analyte: 'sodium', value: '140', collected_at: '2026-09-28T12:00:00Z' })];
    const result = selectChecklistLabs(labs, patientId, new Date('2026-09-29T12:00:00Z'));
    expect(result.potassium.prefill).toBe(4.2); expect(result.potassium.observation?.value).toBe('4.200');
    expect(result.creatinine.observation?.collected_at).toBe('2026-09-19T12:00:00Z'); expect(result.egfr.state).toBe('missing');
    expect(result.potassium.observation?.notes).toBeNull(); expect(result.potassium.observation?.lab_facility).toBeNull();
  });
  it.each(['precision', 'cancelled', 'negative', 'future', 'conflict'])('withholds %s and never revives an older value', (kind) => {
    const latest = source(); const labs = [source(9, { collected_at: '2026-09-01T12:00:00Z' }), latest];
    if (kind === 'precision') latest.value = '4.20000000000000001';
    if (kind === 'cancelled') Object.assign(latest, { root_id: id(20), version_id: id(21), revision: '2', status: 'cancelled', effective_lab_result_id: null, value: null, evaluation_status: null });
    if (kind === 'negative') latest.value = '-4.2';
    if (kind === 'future') latest.collected_at = '2027-01-01T12:00:00Z';
    if (kind === 'conflict') labs.push(source(11, { value: '4.3', collected_at: '2026-09-20T08:00:00.000001-04:00' }));
    const result = selectChecklistLabs(labs, patientId, new Date('2026-09-29T12:00:00Z'));
    expect(result.potassium.prefill).toBeNull(); expect(result.potassium.observation?.id).not.toBe(labs[0].id);
  });
  it('rejects duplicate or wrong-patient snapshots completely', () => {
    expect(() => selectChecklistLabs([source(), source()], patientId)).toThrow();
    expect(() => selectChecklistLabs([source(10, { patient_id: id(99) })], patientId)).toThrow();
  });
});
describe('complete patient selection reads', () => {
  it('loads a linked directory and rejects authentication errors', async () => {
    expect(await readPatientDirectory(client, actor)).toEqual([patient]);
    getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: new Error('Private') });
    await expect(readPatientDirectory(client, actor)).rejects.toThrow(/session/);
  });
  it('paginates251 directory entries and both scoped child tables completely', async () => {
    rows.provider_patient_links = Array.from({ length: 251 }, (_, i) => ({ id: id(i + 1000), provider_id: actor, patient_id: id(i + 2000) }));
    rows.profiles = rows.provider_patient_links.map((link) => ({ ...rows.profiles[0], id: link.patient_id }));
    rows.patients = rows.provider_patient_links.map((link) => ({ id: link.patient_id, risk_tier: null }));
    expect(await readPatientDirectory(client, actor)).toHaveLength(251);
    expect(calls).toEqual({ provider_patient_links: 4, profiles: 3, patients: 3 });
  });
  it.each(['provider_patient_links:1', 'profiles:1', 'patients:1'])('does not interpret %s failure as empty directory', async (value) => {
    failure = value; await expect(readPatientDirectory(client, actor)).rejects.toThrow();
  });
  it('does not read laboratories in tools that did not request them', async () => {
    const selected = await readPatientSelection(client, patient, actor);
    expect(selected.laboratorySnapshots).toBeNull(); expect(rpc.mock.calls.some((call) => call[0] === 'get_effective_lab_observations')).toBe(false);
    expect(selected.medications).toHaveLength(1);
  });
  it('reads251 medications and laboratory sources, preserving the final source', async () => {
    rows.medications = Array.from({ length: 251 }, (_, i) => medication(i + 1000));
    laboratories = Array.from({ length: 251 }, (_, i) => source(i + 2000, { collected_at: i === 250 ? '2026-09-28T12:00:00Z' : '2026-09-20T12:00:00Z' }));
    const selected = await readPatientSelection(client, patient, actor, true);
    expect(selected.medications).toHaveLength(251); expect(calls.medications).toBe(2); expect(calls.labs).toBe(2);
    expect(selected.laboratorySnapshots?.potassium.observation?.original_lab_result_id).toBe(id(2250));
  });
  it.each(['medications:2', 'labs:2', 'vitals:1', 'link'])('discards a selection after %s fails', async (value) => {
    rows.medications = Array.from({ length: 251 }, (_, i) => medication(i + 1000));
    laboratories = Array.from({ length: 251 }, (_, i) => source(i + 2000)); failure = value;
    await expect(readPatientSelection(client, patient, actor, true)).rejects.toThrow();
  });
  it('requires the same account at the final boundary', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: id(99) } }, error: null });
    await expect(readPatientSelection(client, patient, actor, true)).rejects.toThrow(/session/);
  });
  it.each(['selection', 'directory'])('rejects revoked consent/MFA/link with the same actor during %s', async (kind) => {
    const original = rpc.getMockImplementation()!; let authorityReads = 0;
    rpc.mockImplementation(async (...args) => {
      if (args[0] === (kind === 'selection' ? 'provider_has_patient' : 'provider_aal2') && ++authorityReads === 2) return { data: false, error: null };
      return original(...args);
    });
    await expect(kind === 'selection' ? readPatientSelection(client, patient, actor, true) : readPatientDirectory(client, actor)).rejects.toThrow(/access/);
  });
  it('rejects a changed final link set even when provider authority remains valid', async () => {
    const original = from.getMockImplementation()!; let profileRead = false;
    from.mockImplementation((table: string) => {
      if (table === 'profiles') profileRead = true;
      if (table === 'provider_patient_links' && profileRead) rows.provider_patient_links = [];
      return original(table);
    });
    await expect(readPatientDirectory(client, actor)).rejects.toThrow(/links changed/);
  });
});
