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
function database(overrides: Record<string, Row[]> = {}, failedTable?: string, repeatPage = false) {
  const tables: Record<string, Row[]> = {
    provider_patient_links: [{ id: 'link1', patient_id: 'p1' }, { id: 'link2', patient_id: 'p2' }],
    patients: [
      { id: 'p1', risk_tier: null, profiles: { full_name: 'Synthetic One' } },
      { id: 'p2', risk_tier: null, profiles: { full_name: 'Synthetic Two' } },
    ],
    lab_results: [
      { id: 'lab1', patient_id: 'p1', collected_at: '2026-08-01T12:00:00Z', potassium: 4.2 },
      { id: 'lab2', patient_id: 'p1', collected_at: '2026-09-28T12:00:00Z', creatinine: 1.1, egfr: 66 },
      { id: 'lab3', patient_id: 'p2', collected_at: '2026-09-28T12:00:00Z', potassium: 4.1, creatinine: 1.0 },
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
  return { client: { from } as unknown as SupabaseClient, from };
}

describe('Worklist authenticated read projection', () => {
  afterEach(() => vi.useRealTimers());
  it('reads every short page and ranks missing before stale without sharing panel timestamps', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const { client, from } = database();
    const rows = await getTitrationWorklist(client, 'provider');
    expect(rows.map((r) => r.patient_id)).toEqual(['p2', 'p1']);
    expect(rows[1].labs.potassium).toMatchObject({ status: 'stale', collectedAt: '2026-08-01T12:00:00Z' });
    expect(rows[1].labs.creatinine.status).toBe('current');
    expect(rows[0].labs.egfr.status).toBe('missing');
    expect(from.mock.calls.filter(([table]) => table === 'lab_results')).toHaveLength(4);
  });
  it.each(['provider_patient_links', 'patients', 'lab_results', 'vitals', 'provider_notes'])('does not report an empty/healthy worklist when %s fails', async (table) => {
    await expect(getTitrationWorklist(database({}, table).client, 'provider')).rejects.toThrow('could not be verified');
  });
  it('detects non-advancing pagination instead of looping or silently duplicating evidence', async () => {
    await expect(getTitrationWorklist(database({}, undefined, true).client, 'provider')).rejects.toThrow('did not advance');
  });
  it('does not label missing collection as a fresh panel', async () => {
    const rows = await getTitrationWorklist(database({ lab_results: [] }).client, 'provider');
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => Object.values(r.labs).every((q) => q.status === 'missing'))).toBe(true);
  });
  it('does not suppress a patient for an invalid or future titration note', () => {
    expect(isDueTitration('not-a-date')).toBe(true);
    expect(isDueTitration('9999-01-01T00:00:00Z')).toBe(true);
  });
});
