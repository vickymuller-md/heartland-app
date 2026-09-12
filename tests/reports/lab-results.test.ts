import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getReportLabResults, labDateBounds, projectLabResults, type LabPanelRow } from '@/lib/reports/lab-results';

function panel(id: string, collectedAt: string, values: Partial<LabPanelRow> = {}): LabPanelRow {
  return { id, patient_id: 'patient-1', collected_at: collectedAt, ...values };
}

describe('lab report projection', () => {
  it('projects only recorded analytes, retains zero, and never infers a normal or critical flag', () => {
    const result = projectLabResults([panel('a', '2026-08-01T09:15:00-04:00', {
      potassium: 6.2, creatinine: 1.1, egfr: 50, tsat: 0, sodium: null,
    })]);
    expect(result.map((row) => row.test_name)).toEqual(['Potassium', 'Creatinine', 'eGFR', 'TSAT']);
    expect(result.map((row) => row.value)).toEqual([6.2, 1.1, 50, 0]);
    expect(result.every((row) => row.flag === null)).toBe(true);
    expect(result.every((row) => row.collected_at === '2026-08-01T09:15:00-04:00')).toBe(true);
    expect(result[2].unit).toBe('mL/min/1.73m²');
    expect(new Set(result.map((row) => row.id)).size).toBe(4);
  });

  it('retains all thirteen analytes and does not synthesize results for an empty panel', () => {
    expect(projectLabResults([panel('empty', '2026-08-01T00:00:00Z')])).toEqual([]);
    const all = projectLabResults([panel('full', '2026-08-01T00:00:00Z', {
      potassium: 4.5, creatinine: 1.1, egfr: 65, bun: 15, bnp: 80, nt_probnp: 250,
      sodium: 140, glucose: 95, hba1c: 5.5, hemoglobin: 14, ferritin: 80, tsat: 25, ldl: 75,
    })]);
    expect(all).toHaveLength(13);
    expect(new Set(all.map((row) => row.id)).size).toBe(13);
  });

  it('sorts by actual collection instant and uses stable panel IDs for ties', () => {
    const rows = projectLabResults([
      panel('b', '2025-08-01T10:00:00Z', { potassium: 4 }),
      panel('c', '2026-08-01T10:00:00Z', { potassium: 5 }),
      panel('a', '2025-08-01T06:00:00-04:00', { potassium: 3 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['c:potassium', 'a:potassium', 'b:potassium']);
  });

  it('rejects invalid persisted timestamps and non-finite values instead of silently dropping data', () => {
    expect(() => projectLabResults([panel('a', 'not-a-date', { potassium: 4 })])).toThrow(/timestamp/);
    expect(() => projectLabResults([panel('a', '2026-08-01T00:00:00Z', { potassium: Number.NaN })])).toThrow(/value/);
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

describe('wide laboratory query', () => {
  function clientWithPages(pages: Array<{ data: LabPanelRow[] | null; error: null | { message: string } }>) {
    const query = {
      select: vi.fn((_columns: string) => query), in: vi.fn(() => query), gte: vi.fn(() => query),
      lt: vi.fn(() => query), order: vi.fn(() => query), gt: vi.fn(() => query),
      limit: vi.fn(async () => pages.shift() ?? { data: [], error: null }),
    };
    const from = vi.fn(() => query);
    return { client: { from } as unknown as SupabaseClient, from, query };
  }

  it('uses ID keyset pagination even when the service returns less than the requested page size', async () => {
    const { client, query } = clientWithPages([
      { data: [panel('a', '2026-08-01T23:59:59Z', { potassium: 4 })], error: null },
      { data: [panel('b', '2026-08-01T00:00:00Z', { creatinine: 1.1 })], error: null },
      { data: [], error: null },
    ]);
    const rows = await getReportLabResults(client, ['patient-1'], { from: '2026-08-01', to: '2026-08-01' });
    expect(rows).toHaveLength(2);
    const columns = query.select.mock.calls[0][0] as string;
    expect(columns.split(',')).toEqual(expect.arrayContaining(['id', 'patient_id', 'collected_at', 'potassium', 'ldl']));
    expect(columns).not.toMatch(/test_name|\bvalue\b|\bunit\b|\bflag\b/);
    expect(query.in).toHaveBeenCalledWith('patient_id', ['patient-1']);
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(query.gt.mock.calls).toEqual([['id', 'a'], ['id', 'b']]);
    expect(query.lt).toHaveBeenCalledWith('collected_at', '2026-08-02T00:00:00.000Z');
    expect(query.limit).toHaveBeenCalledTimes(3);
  });

  it('returns no labs without patients and does not query the database', async () => {
    const { client, from } = clientWithPages([]);
    expect(await getReportLabResults(client, [], { from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('fails the whole export when a subsequent page fails', async () => {
    const { client } = clientWithPages([
      { data: [panel('a', '2026-08-01T12:00:00Z', { potassium: 4 })], error: null },
      { data: null, error: { message: 'Unavailable' } },
    ]);
    await expect(getReportLabResults(client, ['patient-1'], { from: '2026-08-01', to: '2026-08-31' }))
      .rejects.toMatchObject({ message: 'Unavailable' });
  });

  it('rejects repeated pages rather than producing a duplicate or incomplete export', async () => {
    const repeated = panel('a', '2026-08-01T12:00:00Z', { potassium: 4 });
    const { client } = clientWithPages([
      { data: [repeated], error: null }, { data: [repeated], error: null },
    ]);
    await expect(getReportLabResults(client, ['patient-1'], { from: '2026-08-01', to: '2026-08-31' }))
      .rejects.toThrow(/pagination did not advance/);
  });
});
