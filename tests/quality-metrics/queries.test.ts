/**
 * Quality Metrics Query Tests -- CKM-04
 * Requirements: CKM-04 (Trend over time, monthly quality metric history)
 * Source: HEARTLAND Protocol v3.3 Module 8 Quality Metrics
 *
 * Tests getMetricHistory query shape: date range cutoff, filtering,
 * empty results, and ordering.
 * Uses vi.fn() mock for Supabase client.
 */

import { getMetricHistory } from '@/lib/quality-metrics/queries';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startOfMonth, subMonths, format } from 'date-fns';

// Build a chainable Supabase mock
function createMockSupabase(returnData: unknown[] | null = null, returnError: unknown = null) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  };
  return chain;
}

describe('CKM-04 getMetricHistory', () => {
  it('Queries with cutoff date = startOfMonth(subMonths(today, 5)) for default 6-month window', async () => {
    const mock = createMockSupabase([]);
    const expectedCutoff = format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd');

    await getMetricHistory(mock as never, 'provider-1', 'contact_48_72h');

    expect(mock.gte).toHaveBeenCalledWith('period_month', expectedCutoff);
  });

  it('Filters by provider_id and metric_key', async () => {
    const mock = createMockSupabase([]);

    await getMetricHistory(mock as never, 'abc', 'gdmt_discharge_rate');

    expect(mock.eq).toHaveBeenCalledWith('provider_id', 'abc');
    expect(mock.eq).toHaveBeenCalledWith('metric_key', 'gdmt_discharge_rate');
  });

  it('Returns empty array when no records exist', async () => {
    const mock = createMockSupabase(null);

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
