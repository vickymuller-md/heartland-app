// EFFI-03: Titration worklist — patients due for titration this week
// Tests for isDueTitration pure function
// Implementation in: lib/dashboard/worklist-queries.ts

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTitrationWorklist, isDueTitration } from '@/lib/dashboard/worklist-queries';
import { subDays } from 'date-fns';

describe('isDueTitration (EFFI-03)', () => {
  it('returns true when lastTitrationAt is null (never titrated)', () => {
    expect(isDueTitration(null)).toBe(true);
  });

  it('returns false when lastTitrationAt is 6 days ago', () => {
    const sixDaysAgo = subDays(new Date(), 6).toISOString();
    expect(isDueTitration(sixDaysAgo)).toBe(false);
  });

  it('returns true when lastTitrationAt is exactly 7 days ago', () => {
    const sevenDaysAgo = subDays(new Date(), 7).toISOString();
    expect(isDueTitration(sevenDaysAgo)).toBe(true);
  });

  it('returns true when lastTitrationAt is 14 days ago', () => {
    const fourteenDaysAgo = subDays(new Date(), 14).toISOString();
    expect(isDueTitration(fourteenDaysAgo)).toBe(true);
  });
});

type Row = Record<string, unknown> & { id: string };
const id = (n: number) => `62000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const provider = id(1); const p1 = id(11); const p2 = id(12);
function database(overrides: Record<string, Row[]> = {}, failedTable?: string, repeatPage = false) {
  const tables: Record<string, Row[]> = {
    provider_patient_links: [{ id: 'link1', patient_id: p1 }, { id: 'link2', patient_id: p2 }],
    patients: [
      { id: p1, risk_tier: null, profiles: { full_name: 'Synthetic One' } },
      { id: p2, risk_tier: null, profiles: { full_name: 'Synthetic Two' } },
    ],
    lab_results: [
      { id: id(101), patient_id: p1, collected_at: '2026-08-01T12:00:00Z', potassium: 4.2 },
      { id: id(102), patient_id: p1, collected_at: '2026-09-28T12:00:00Z', creatinine: 1.1, egfr: 66 },
      { id: id(103), patient_id: p2, collected_at: '2026-09-28T12:00:00Z', potassium: 4.1, creatinine: 1.0 },
    ],
    vitals: [], provider_notes: [], ...overrides,
  };
  const from = vi.fn((table: string) => {
    let cursor: string | null = null;
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), ilike: vi.fn().mockReturnThis(),
      gt: vi.fn((_key: string, value: string) => { cursor = value; return query; }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({
        data: tables[table].filter((row) => repeatPage || !cursor || row.id > cursor).slice(0, 1),
        error: table === failedTable ? { message: 'private database failure' } : null,
      }).then(resolve),
    };
    return query;
  });
  const rpc = vi.fn().mockImplementation(async (_name: string, args: { p_patient_ids: string[] }) => ({ data: { actor_id: provider, patient_ids: args.p_patient_ids, snapshot: 'a'.repeat(64), next_cursor: null,
    items: overrides.effective_lab_observations ?? tables.lab_results.flatMap((row) => ['potassium', 'creatinine', 'egfr'].flatMap((analyte) =>
      row[analyte] == null ? [] : [{ id: `${row.id}:${analyte}`, original_lab_result_id: row.id, patient_id: row.patient_id, analyte,
        root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: row.id,
        value: String(row[analyte]), collected_at: row.collected_at, notes: null, lab_facility: null, evaluation_status: null }]))
      .sort((a, b) => a.id.localeCompare(b.id)),
  }, error: failedTable === 'lab_results' ? { message: 'controlled projection failure' } : null }));
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

describe('Worklist authenticated read projection', () => {
  afterEach(() => vi.useRealTimers());
  it('reads every short page and ranks missing before stale without sharing panel timestamps', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const { client, from, rpc } = database();
    const rows = await getTitrationWorklist(client, provider);
    expect(rows.map((r) => r.patient_id)).toEqual([p2, p1]);
    expect(rows[1].labs.potassium).toMatchObject({ status: 'stale', collectedAt: '2026-08-01T12:00:00Z' });
    expect(rows[1].labs.creatinine.status).toBe('current');
    expect(rows[0].labs.egfr.status).toBe('missing');
    expect(rows[1].labs.potassium.value).toBe('4.2');
    expect(from.mock.calls.filter(([table]) => table === 'lab_results')).toHaveLength(0);
    expect(rpc).toHaveBeenCalledWith('get_effective_lab_observations', { p_patient_ids: [p1, p2], p_after: null, p_snapshot: null });
  });
  it.each(['provider_patient_links', 'patients', 'lab_results', 'vitals', 'provider_notes'])('does not report an empty/healthy worklist when %s fails', async (table) => {
    await expect(getTitrationWorklist(database({}, table).client, provider)).rejects.toThrow('could not be verified');
  });
  it('detects non-advancing pagination instead of looping or silently duplicating evidence', async () => {
    await expect(getTitrationWorklist(database({}, undefined, true).client, provider)).rejects.toThrow('did not advance');
  });
  it('does not label missing collection as a fresh panel', async () => {
    const rows = await getTitrationWorklist(database({ lab_results: [] }).client, provider);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => Object.values(r.labs).every((q) => q.status === 'missing'))).toBe(true);
  });
  it('does not suppress a patient for an invalid or future titration note', () => {
    expect(isDueTitration('not-a-date')).toBe(true);
    expect(isDueTitration('9999-01-01T00:00:00Z')).toBe(true);
  });
  it('does not display the original value when its current source is cancelled', async () => {
    const cancelled = { id: `${id(101)}:potassium`, original_lab_result_id: id(101), patient_id: p1, analyte: 'potassium',
      root_id: id(201), version_id: id(301), revision: '2', status: 'cancelled', effective_lab_result_id: null,
      value: null, collected_at: '2026-09-28T12:00:00Z', notes: null, lab_facility: null, evaluation_status: null };
    const rows = await getTitrationWorklist(database({ effective_lab_observations: [cancelled] }).client, provider);
    expect(rows.find((row) => row.patient_id === p1)?.labs.potassium).toMatchObject({ status: 'cancelled', value: null,
      source: { status: 'cancelled', revision: '2' } });
  });

  it.each([false, true])('reads all 501 linked patients without a partial result if a later scope fails (failure=%s)', async (failSecond) => {
    const people = Array.from({ length: 501 }, (_, n) => ({ id: id(n + 1000), risk_tier: null, profiles: { full_name: `Synthetic ${n}` } }));
    const { client, rpc } = database({ patients: people, lab_results: [],
      provider_patient_links: people.map((person) => ({ id: person.id, patient_id: person.id })) });
    let scopeNumber = 0;
    rpc.mockImplementation(async (_name: string, args: { p_patient_ids: string[] }) => {
      scopeNumber += 1;
      return { data: { actor_id: provider, patient_ids: args.p_patient_ids, snapshot: 'a'.repeat(64), next_cursor: null, items: [] },
        error: failSecond && scopeNumber === 2 ? { message: 'controlled late failure' } : null };
    });
    if (failSecond) await expect(getTitrationWorklist(client, provider)).rejects.toThrow('could not be verified');
    else expect(await getTitrationWorklist(client, provider)).toHaveLength(501);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.map(([, args]) => args.p_patient_ids.length)).toEqual([500, 1]);
    expect(rpc.mock.calls.flatMap(([, args]) => args.p_patient_ids)).toEqual(people.map((person) => person.id));
  });
});
