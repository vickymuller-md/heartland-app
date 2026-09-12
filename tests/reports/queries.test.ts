/**
 * Report Query Tests -- REPT-01, REPT-02
 * Requirements: REPT-01 (Monthly Report), REPT-02 (Patient Summary)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21 Reports & Data Export
 *
 * Tests query shape contracts for monthly report aggregation and
 * patient summary data retrieval against the persisted wide lab schema.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const { mockDetail } = vi.hoisted(() => ({ mockDetail: vi.fn() }));
vi.mock('@/lib/dashboard/queries', () => ({ getPatientDetail: mockDetail }));
import {
  getMonthlyReportData,
  getPatientSummaryData,
} from '@/lib/reports/queries';

const detail = {
  patient: { id: 'patient-1', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null },
  vitals: [], symptoms: [], adherenceSummary: null, educationProgress: null, notes: [], openAlerts: [],
};

function labClient(failure?: string) {
  let selection = '';
  let page = 0;
  const query = {
    select: vi.fn((columns: string) => { selection = columns; return query; }),
    eq: vi.fn(() => query), in: vi.fn(() => query), gte: vi.fn(() => query),
    lte: vi.fn(() => query), lt: vi.fn(() => query), gt: vi.fn(() => query),
    order: vi.fn(() => query), limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => {
      if (failure || /test_name|\bvalue\b|\bunit\b|\bflag\b/.test(selection)) {
        return resolve({ data: null, error: { message: failure ?? 'column lab_results.test_name does not exist' } });
      }
      return resolve({ data: page++ === 0 ? [{
        id: 'lab-1', patient_id: 'patient-1', collected_at: '2025-08-01T13:15:00Z', potassium: 6.2,
      }] : [], error: null });
    },
  };
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}

beforeEach(() => { vi.clearAllMocks(); mockDetail.mockResolvedValue(detail); });

describe('REPT-01 getMonthlyReportData', () => {
  it('is a callable function', () => {
    // Ensures the import resolves -- will fail RED until lib/reports/queries.ts exists
    expect(typeof getMonthlyReportData).toBe('function');
  });

  it.todo('returns correct count of active patients for date range');
  it.todo('counts alerts generated in period by severity');
  it.todo('counts titration notes from provider_notes ILIKE [Titration]%');
  it.todo('calculates avgCheckInCompliance as % patients with >=16 vitals days');
});

describe('REPT-02 getPatientSummaryData', () => {
  it('is a callable function', () => {
    // Ensures the import resolves -- will fail RED until lib/reports/queries.ts exists
    expect(typeof getPatientSummaryData).toBe('function');
  });

  it.todo('returns vitals array ordered by recorded_at desc');
  it('queries real lab columns and preserves historical collection with no invented flag', async () => {
    const { client, query } = labClient();
    const range = { from: '2025-08-01', to: '2025-08-31' };
    const result = await getPatientSummaryData(client, 'patient-1', 'provider-1', range);
    expect(mockDetail).toHaveBeenCalledWith(client, 'provider-1', 'patient-1');
    expect(result?.labs).toEqual([expect.objectContaining({
      id: 'lab-1:potassium', test_name: 'Potassium', value: 6.2, unit: 'mEq/L',
      collected_at: '2025-08-01T13:15:00Z', flag: null,
    })]);
    expect(query.in).toHaveBeenCalledWith('patient_id', ['patient-1']);
    expect(query.gte).toHaveBeenCalledWith('collected_at', '2025-08-01T00:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('collected_at', '2025-09-01T00:00:00.000Z');
  });

  it('does not query labs when the provider has no patient detail access', async () => {
    mockDetail.mockResolvedValue(null);
    const { client, from } = labClient();
    expect(await getPatientSummaryData(client, 'patient-1', 'provider-1', { from: '2026-08-01', to: '2026-08-31' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates a laboratory query failure instead of returning empty labs', async () => {
    const { client } = labClient('Lab query unavailable');
    await expect(getPatientSummaryData(client, 'patient-1', 'provider-1', { from: '2026-08-01', to: '2026-08-31' }))
      .rejects.toMatchObject({ message: 'Lab query unavailable' });
  });
  it.todo('returns education progress per domain');
});
