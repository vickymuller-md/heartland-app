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
  patient: { id: '64000000-0000-4000-8000-000000000011', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null },
  vitals: [], symptoms: [], adherenceSummary: null, educationProgress: null, notes: [], openAlerts: [],
};

function labClient(failure?: string) {
  const rpc = vi.fn().mockResolvedValue({ data: { actor_id: '64000000-0000-4000-8000-000000000001',
    patient_ids: ['64000000-0000-4000-8000-000000000011'], snapshot: 'a'.repeat(64), next_cursor: null,
    items: [{ id: '64000000-0000-4000-8000-000000000101:potassium', original_lab_result_id: '64000000-0000-4000-8000-000000000101',
      patient_id: '64000000-0000-4000-8000-000000000011', analyte: 'potassium', root_id: null, version_id: null, revision: null,
      status: 'original', effective_lab_result_id: '64000000-0000-4000-8000-000000000101', value: '6.2',
      collected_at: '2025-08-01T13:15:00Z', notes: null, lab_facility: null, evaluation_status: null }],
    }, error: failure ? { message: failure } : null });
  const from = vi.fn(() => { throw new Error('No raw laboratory fallback'); });
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
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
  it('reads effective sources under the expected provider and preserves actual collection without a flag', async () => {
    const { client, rpc } = labClient();
    const range = { from: '2025-08-01', to: '2025-08-31' };
    const result = await getPatientSummaryData(client, '64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', range);
    expect(mockDetail).toHaveBeenCalledWith(client, '64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000011');
    expect(result?.labs).toEqual([expect.objectContaining({
      id: '64000000-0000-4000-8000-000000000101:potassium', test_name: 'Potassium', value: '6.2', unit: 'mEq/L',
      collected_at: '2025-08-01T13:15:00Z', flag: null,
    })]);
    expect(rpc).toHaveBeenCalledWith('get_effective_lab_observations', {
      p_patient_ids: ['64000000-0000-4000-8000-000000000011'], p_after: null, p_snapshot: null,
    });
  });

  it('does not query labs when the provider has no patient detail access', async () => {
    mockDetail.mockResolvedValue(null);
    const { client, from } = labClient();
    expect(await getPatientSummaryData(client, '64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', { from: '2026-08-01', to: '2026-08-31' })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('propagates a laboratory query failure instead of returning empty labs', async () => {
    const { client } = labClient('Lab query unavailable');
    await expect(getPatientSummaryData(client, '64000000-0000-4000-8000-000000000011', '64000000-0000-4000-8000-000000000001', { from: '2026-08-01', to: '2026-08-31' }))
      .rejects.toThrow('could not be verified');
  });
  it.todo('returns education progress per domain');
});
