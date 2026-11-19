/**
 * Quality Metrics Query Tests -- CKM-04
 * Requirements: CKM-04 (Trend over time, monthly quality metric history)
 * Source: HEARTLAND Protocol v3.3 Module 8 Quality Metrics
 *
 * Tests getMetricHistory query shape: date range cutoff, filtering,
 * empty results, and ordering.
 * Uses vi.fn() mock for Supabase client.
 */

import { getMetricHistory, getQualityMetrics } from '@/lib/quality-metrics/queries';
import { describe, it, expect, vi } from 'vitest';
import { METRIC_DEFINITIONS } from '@/lib/quality-metrics/constants';

// Build a chainable Supabase mock
function createMockSupabase(returnData: unknown[] | null = null, returnError: unknown = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  return chain;
}

describe('CKM-04 getMetricHistory', () => {
  it('Queries with cutoff date = startOfMonth(subMonths(today, 5)) for default 6-month window', async () => {
    const mock = createMockSupabase([]);
    const now = new Date();
    const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0,10);

    await getMetricHistory(mock as never, 'provider-1', 'contact_48_72h');

    expect(mock.gte).toHaveBeenCalledWith('period_month', month(-5));
    expect(mock.lt).toHaveBeenCalledWith('period_month', month(1));
  });

  it('Filters by provider_id and metric_key', async () => {
    const mock = createMockSupabase([]);

    await getMetricHistory(mock as never, 'abc', 'gdmt_discharge_rate');

    expect(mock.eq).toHaveBeenCalledWith('provider_id', 'abc');
    expect(mock.eq).toHaveBeenCalledWith('metric_key', 'gdmt_discharge_rate');
  });

  it('Returns empty array when no records exist', async () => {
    const mock = createMockSupabase([]);

    const result = await getMetricHistory(mock as never, 'abc', 'contact_48_72h');

    expect(result).toEqual([]);
  });

  it('Returns data ordered by period_month ascending', async () => {
    const mock = createMockSupabase([
      { period_month: '2026-01-01', rate_pct: 70 },
      { period_month: '2026-02-01', rate_pct: 75 },
    ]);

    await getMetricHistory(mock as never, 'abc', 'contact_48_72h');

    expect(mock.order).toHaveBeenCalledWith('period_month', { ascending: true });
  });
});

describe('latest reporting-period evidence', () => {
  it('reads one bounded row per measure, including infrequently entered measures', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const db = { from: vi.fn().mockReturnValue(query) };
    query.maybeSingle.mockResolvedValueOnce({ data: { metric_key: 'contact_48_72h' }, error: null });
    expect(await getQualityMetrics(db as never, 'provider')).toEqual([{ metric_key: 'contact_48_72h' }]);
    for (const {key} of METRIC_DEFINITIONS) expect(query.eq).toHaveBeenCalledWith('metric_key', key);
    expect(query.limit).toHaveBeenCalledWith(1);
  });
});
