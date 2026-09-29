import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getReportLabResults, labDateBounds, projectLabResults } from '@/lib/reports/lab-results';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

const id = (n: number) => `64000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1); const patient = id(11);
const range = { from: '2026-08-01', to: '2026-08-31' };
function source(n: number, patch: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation {
  const item = { id: '', original_lab_result_id: id(n), patient_id: patient, analyte: 'potassium' as const,
    root_id: null, version_id: null, revision: null, status: 'original' as const, effective_lab_result_id: id(n),
    value: '4.2', collected_at: '2026-08-01T12:00:00Z', notes: null, lab_facility: null, evaluation_status: null, ...patch };
  return { ...item, id: `${item.original_lab_result_id}:${item.analyte}` };
}
function clientWithPages(pages: Array<{ items?: EffectiveLabObservation[]; error?: boolean; next?: string | null; actor?: string; snapshot?: string }>) {
  const rpc = vi.fn(async (_name: string, args: { p_patient_ids: string[] }) => {
    const page = pages.shift() ?? { items: [] };
    return { data: { actor_id: page.actor ?? actor, patient_ids: args.p_patient_ids,
      snapshot: page.snapshot ?? 'a'.repeat(64), items: page.items ?? [], next_cursor: page.next ?? null },
      error: page.error ? { message: 'Private database failure' } : null };
  });
  const from = vi.fn(() => { throw new Error('Raw fallback forbidden'); });
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, from };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('effective laboratory report projection', () => {
  it('retains all thirteen analytes, exact values, zero and source precision without inferred flags', () => {
    const items = Object.keys(LAB_OBSERVATION_FIELDS).map((analyte, n) => source(n + 101, {
      analyte: analyte as EffectiveLabObservation['analyte'], value: n === 0 ? '4.200000000000000001' : '0',
      collected_at: '2026-08-01T09:15:00.123456-04:00',
    }));
    const result = projectLabResults(items);
    expect(result).toHaveLength(13);
    expect(result[0].value).toBe('4.200000000000000001');
    expect(result.every((row) => row.flag === null && row.data_quality === 'recorded')).toBe(true);
    expect(result.every((row) => row.collected_at === items[0].collected_at)).toBe(true);
    expect(projectLabResults([])).toEqual([]);
  });
  it('uses current corrected provenance and cancelled tombstones, never the original numeric value', () => {
    const result = projectLabResults([
      source(101, { status: 'corrected', root_id: id(201), version_id: id(301), revision: '2', effective_lab_result_id: id(401), value: '4.1', evaluation_status: 'pending' }),
      source(102, { analyte: 'creatinine', status: 'cancelled', root_id: id(202), version_id: id(302), revision: '3', effective_lab_result_id: null, value: null }),
    ]);
    expect(result[0]).toMatchObject({ value: '4.1', source_status: 'corrected', revision: '2', effective_lab_result_id: id(401), evaluation_status: 'pending' });
    expect(result[1]).toMatchObject({ value: null, source_status: 'cancelled', data_quality: 'cancelled' });
  });
  it('sorts by actual instants and microseconds, not timestamp spelling', () => {
    const result = projectLabResults([
      source(101, { collected_at: '2026-08-01T12:00:00Z' }),
      source(102, { collected_at: '2026-08-01T12:00:00.000001Z' }),
      source(103, { collected_at: '2026-08-01T14:00:00+03:00' }),
    ]);
    expect(result.map((r) => r.id)).toEqual([102, 101, 103].map((n) => `${id(n)}:potassium`));
  });
  it.each(Object.keys(LAB_OBSERVATION_FIELDS))('labels negative/future/conflicting %s without hiding the recorded source', (analyte) => {
    const field = analyte as EffectiveLabObservation['analyte'];
    const result = projectLabResults([
      source(101, { analyte: field, value: '-0.000000000000000001' }),
      source(102, { analyte: field, value: '1', collected_at: '2026-10-01T12:00:00Z' }),
      source(103, { analyte: field, value: '1', collected_at: '2026-08-02T12:00:00Z' }),
      source(104, { analyte: field, value: '2', collected_at: '2026-08-02T12:00:00Z' }),
    ]);
    expect(result.every((row) => row.data_quality === 'invalid' && row.flag === null)).toBe(true);
    expect(result.find((row) => row.original_lab_result_id === id(101))?.value).toBe('-0.000000000000000001');
  });
  it.each([{ value: 'NaN' }, { collected_at: 'bad' }])('rejects malformed stored DTOs instead of silently dropping an analyte', (patch) => {
    expect(() => projectLabResults([source(101, patch)])).toThrow();
  });
});

describe('laboratory calendar range', () => {
  it.each([
    ['2026-03-08', '2026-03-09T00:00:00.000Z'],
    ['2026-11-01', '2026-11-02T00:00:00.000Z'],
    ['2024-02-29', '2024-03-01T00:00:00.000Z'],
    ['2026-12-31', '2027-01-01T00:00:00.000Z'],
  ])('uses inclusive UTC calendar day %s with an exclusive next-day bound', (day, next) => {
    expect(labDateBounds({ from: day, to: day })).toEqual({ fromInclusive: `${day}T00:00:00.000Z`, toExclusive: next });
  });

  it.each([
    { from: '2026-02-30', to: '2026-03-01' }, { from: '', to: '2026-08-01' },
    { from: '2026-08-02', to: '2026-08-01' }, { from: '2024-01-01', to: '2026-01-01' },
  ])('rejects invalid or excessive ranges: %j', (range) => {
    expect(() => labDateBounds(range)).toThrow(/date range/i);
  });
});


describe('effective laboratory report read', () => {
  it('filters after full read and includes the entire final UTC day at microsecond precision', async () => {
    const { client, rpc, from } = clientWithPages([{ items: [
      source(101, { collected_at: '2026-07-31T23:59:59.999999Z' }),
      source(102, { collected_at: '2026-08-01T00:00:00Z' }),
      source(103, { collected_at: '2026-08-31T23:59:59.999999Z' }),
      source(104, { collected_at: '2026-09-01T00:00:00Z' }),
    ] }]);
    const rows = await getReportLabResults(client, [patient], range, actor);
    expect(rows.map((row) => row.original_lab_result_id)).toEqual([id(103), id(102)]);
    expect(rpc).toHaveBeenCalledWith('get_effective_lab_observations', { p_patient_ids: [patient], p_after: null, p_snapshot: null });
    expect(from).not.toHaveBeenCalled();
  });
  it.each(['2026-08-20T00:00:00Z', '2026-09-20T00:00:00Z'])('uses corrected collection %s rather than original draw for the range', async (collected_at) => {
    const { client } = clientWithPages([{ items: [source(101, { collected_at, status: 'corrected', root_id: id(201),
      version_id: id(301), revision: '2', effective_lab_result_id: id(401) })] }]);
    const rows = await getReportLabResults(client, [patient], range, actor);
    expect(rows).toHaveLength(collected_at.startsWith('2026-08') ? 1 : 0);
  });
  it.each([false, true])('reads all pages and rejects the whole result on later failure=%s', async (failure) => {
    const first = Array.from({ length: 250 }, (_, n) => source(n + 1000));
    const { client, rpc } = clientWithPages([{ items: first, next: first.at(-1)!.id }, { items: [source(2000)], error: failure }]);
    if (failure) await expect(getReportLabResults(client, [patient], range, actor)).rejects.toThrow('could not be verified');
    else expect(await getReportLabResults(client, [patient], range, actor)).toHaveLength(251);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])('reads all 501 patients and rejects the whole result on later scope failure=%s', async (failure) => {
    const ids = Array.from({ length: 501 }, (_, n) => id(n + 1000));
    const { client, rpc } = clientWithPages([{ items: [source(3000, { patient_id: ids[0] })] }, { error: failure }]);
    if (failure) await expect(getReportLabResults(client, ids, range, actor)).rejects.toThrow('could not be verified');
    else expect(await getReportLabResults(client, ids, range, actor)).toHaveLength(1);
    expect(rpc.mock.calls.map(([, args]) => args.p_patient_ids.length)).toEqual([500, 1]);
  });
  it('rejects an actor mismatch and does not query without patients', async () => {
    const wrong = clientWithPages([{ actor: id(9) }]);
    await expect(getReportLabResults(wrong.client, [patient], range, actor)).rejects.toThrow('could not be verified');
    const empty = clientWithPages([]);
    expect(await getReportLabResults(empty.client, [], range, actor)).toEqual([]);
    expect(empty.rpc).not.toHaveBeenCalled();
  });
});
