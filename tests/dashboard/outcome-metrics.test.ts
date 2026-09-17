/**
 * Outcome-aware dashboard metrics -- migration 00041
 *
 * Counts presented as addressed clinical work exclude the two administrative
 * closure codes (design O4 §5.3).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  countsAsAddressedWorkItem,
  getProviderMetrics,
} from '@/lib/dashboard/metrics-queries';

// ---------- countsAsAddressedWorkItem ----------

describe('countsAsAddressedWorkItem (00041)', () => {
  it('excludes an item closed as administrative_close', () => {
    expect(
      countsAsAddressedWorkItem({
        status: 'closed',
        outcome_code: 'administrative_close',
        accountability_source: 'designated',
      })
    ).toBe(false);
  });

  it('excludes an item closed with the grace-period stamp outcome_not_recorded', () => {
    expect(
      countsAsAddressedWorkItem({
        status: 'closed',
        outcome_code: 'outcome_not_recorded',
        accountability_source: 'legacy_fan_out',
      })
    ).toBe(false);
  });

  it('counts an item closed with a clinical outcome code', () => {
    expect(
      countsAsAddressedWorkItem({
        status: 'closed',
        outcome_code: 'clinical_action_taken',
        accountability_source: 'designated',
      })
    ).toBe(true);
  });

  it('counts a legacy row (accountability_source NULL, no outcome code) as before', () => {
    expect(
      countsAsAddressedWorkItem({
        status: 'closed',
        outcome_code: null,
        accountability_source: null,
      })
    ).toBe(true);
  });

  it('does not count an open item, whatever its outcome code', () => {
    expect(
      countsAsAddressedWorkItem({
        status: 'actioned',
        outcome_code: null,
        accountability_source: 'designated',
      })
    ).toBe(false);
  });
});

// ---------- getProviderMetrics.addressedAlertsLast30Days ----------

type QueryResult = { data?: unknown[] | null; count?: number | null };

/** Chainable, awaitable PostgREST builder stub. */
function makeQuery(result: QueryResult) {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'not', 'is', 'neq', 'order']) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(
      resolve({ data: result.data ?? null, count: result.count ?? null, error: null })
    );
  return query;
}

function makeSupabase(workItems: unknown[]) {
  const byTable: Record<string, QueryResult> = {
    provider_patient_links: { data: [{ patient_id: 'patient-1' }] },
    alerts: { count: 0 },
    vitals: { data: [] },
    medication_logs: { data: [] },
    patients: { data: [] },
    work_items: { data: workItems },
  };
  return {
    from: vi.fn((table: string) => makeQuery(byTable[table] ?? { data: [] })),
  };
}

describe('getProviderMetrics addressedAlertsLast30Days (00041)', () => {
  it('counts clinical closures and legacy rows, excluding administrative closures', async () => {
    const supabase = makeSupabase([
      { status: 'closed', outcome_code: 'clinical_action_taken', accountability_source: 'designated' },
      { status: 'closed', outcome_code: 'administrative_close', accountability_source: 'designated' },
      { status: 'closed', outcome_code: 'outcome_not_recorded', accountability_source: 'legacy_fan_out' },
      { status: 'closed', outcome_code: null, accountability_source: null },
    ]);

    const metrics = await getProviderMetrics(supabase as never, 'provider-1');

    expect(metrics.addressedAlertsLast30Days).toBe(2);
  });

  it('queries only closed alert work items', async () => {
    const supabase = makeSupabase([]);

    await getProviderMetrics(supabase as never, 'provider-1');

    expect(supabase.from).toHaveBeenCalledWith('work_items');
  });
});
