import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAlerts } from '@/lib/dashboard/queries';

type QueryResult = { data: unknown[] | null; error: { message: string } | null; count?: number | null };

function query(result: QueryResult) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    then: (resolve: (result: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function client(overrides: Partial<Record<'provider_patient_links' | 'alerts' | 'work_items', QueryResult>> = {}) {
  const chains = {
    provider_patient_links: query(overrides.provider_patient_links ?? { data: [{ patient_id: 'patient-1' }], error: null }),
    alerts: query(overrides.alerts ?? { data: [], error: null, count: 0 }),
    work_items: query(overrides.work_items ?? { data: [], error: null }),
  };
  const from = vi.fn((table: keyof typeof chains) => chains[table]);
  return { supabase: { from } as unknown as SupabaseClient, from, chains };
}

describe('getAlerts fail-closed inbox queries', () => {
  it.each([{ label: 'null', data: null }, { label: 'empty array', data: [] }])('does not treat a failed patient-link lookup as an empty inbox (data=$label)', async ({ data }) => {
    const error = { message: 'Synthetic link lookup failure' };
    const { supabase, from } = client({ provider_patient_links: { data, error } });
    await expect(getAlerts(supabase, 'provider-1', 'open')).rejects.toEqual(error);
    expect(from.mock.calls).toEqual([['provider_patient_links']]);
  });

  it('returns an empty inbox only after a successful lookup with no linked patients', async () => {
    const { supabase, from, chains } = client({ provider_patient_links: { data: [], error: null } });
    await expect(getAlerts(supabase, 'provider-1', 'open')).resolves.toEqual({ alerts: [], total: 0 });
    expect(chains.provider_patient_links.eq.mock.calls).toEqual([['provider_id', 'provider-1'], ['status', 'active']]);
    expect(from.mock.calls).toEqual([['provider_patient_links']]);
  });

  it('returns a successful empty alert query without looking up accountability', async () => {
    const { supabase, from } = client();
    await expect(getAlerts(supabase, 'provider-1', 'open')).resolves.toEqual({ alerts: [], total: 0 });
    expect(from.mock.calls).toEqual([['provider_patient_links'], ['alerts']]);
  });

  it('propagates an alert query failure instead of returning no alerts', async () => {
    const error = { message: 'Synthetic alert query failure' };
    const { supabase } = client({ alerts: { data: null, error } });
    await expect(getAlerts(supabase, 'provider-1')).rejects.toEqual(error);
  });

  it('propagates an accountability query failure rather than claiming no owner', async () => {
    const error = { message: 'Synthetic accountability query failure' };
    const { supabase } = client({ alerts: { data: [{ id: 'alert-1' }], error: null, count: 1 }, work_items: { data: null, error } });
    await expect(getAlerts(supabase, 'provider-1')).rejects.toEqual(error);
  });

  it('preserves patient scope, filter, pagination, total and accountable owner on success', async () => {
    const { supabase, chains } = client({
      alerts: { data: [{ id: 'alert-1', patient_id: 'patient-1', patients: { profiles: { full_name: 'Synthetic Patient' } }, flags: ['sbp_low'], severity: 'critical', status: 'open' }], error: null, count: 35 },
      work_items: { data: [{ source_id: 'alert-1', assigned_to: 'provider-1', assignee: { full_name: 'Synthetic Provider' }, status: 'new', accountability_source: 'designated', underlying_alert_resolved_at: null }], error: null },
    });
    const result = await getAlerts(supabase, 'provider-1', 'open', { limit: 25, offset: 25 });
    expect(result).toMatchObject({ total: 35, alerts: [{ id: 'alert-1', patient_name: 'Synthetic Patient', status: 'open', accountable_provider_name: 'Synthetic Provider', outcome_required: false }] });
    expect(chains.alerts.in).toHaveBeenCalledWith('patient_id', ['patient-1']);
    expect(chains.alerts.eq).toHaveBeenCalledExactlyOnceWith('status', 'open');
    expect(chains.alerts.order.mock.calls).toEqual([['last_seen_at', { ascending: false }], ['id', { ascending: true }]]);
    expect(chains.alerts.range).toHaveBeenCalledExactlyOnceWith(25, 49);
    expect(chains.work_items.in).toHaveBeenCalledExactlyOnceWith('source_id', ['alert-1']);
  });

  it('omits the status constraint for the all filter', async () => {
    const { supabase, chains } = client();
    await getAlerts(supabase, 'provider-1', 'all');
    expect(chains.alerts.eq).not.toHaveBeenCalled();
  });
});
