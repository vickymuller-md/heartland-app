import { describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAlerts, getUrgentAlertCount } from '@/lib/dashboard/queries';
import { getLinkedPatientIds } from '@/lib/supabase/linked-patients';

type QueryResult = { data: unknown[] | null; error: { message: string } | null; count?: number | null };

function query(result: QueryResult) {
  const chain = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    then: (resolve: (result: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function client(overrides: Partial<Record<'alerts' | 'work_items', QueryResult>> = {}) {
  const chains = {
    alerts: query(overrides.alerts ?? { data: [], error: null, count: 0 }),
    work_items: query(overrides.work_items ?? { data: [], error: null }),
  };
  const from = vi.fn((table: keyof typeof chains) => chains[table]);
  return { supabase: { from } as unknown as SupabaseClient, from, chains };
}

describe('getAlerts fail-closed inbox queries', () => {
  it('returns an empty inbox after a successful scoped read without requesting accountability', async () => {
    const { supabase, from } = client();
    await expect(getAlerts(supabase, 'provider-1', 'open')).resolves.toEqual({ alerts: [], total: 0 });
    expect(from.mock.calls).toEqual([['alerts']]);
  });

  it.each([{ data: null, count: 0 }, { data: [], count: null }])('rejects an incomplete inbox response', async (incomplete) => {
    const { supabase } = client({ alerts: { ...incomplete, error: null } });
    await expect(getAlerts(supabase, 'provider-1')).rejects.toThrow('Alert inbox unavailable');
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
    expect(chains.alerts.in).not.toHaveBeenCalled();
    expect(chains.alerts.select.mock.calls[0][0]).toContain('scope:provider_patient_links!provider_patient_links_patient_id_fkey!inner()');
    expect(chains.alerts.eq.mock.calls).toEqual([
      ['patients.profiles.scope.provider_id', 'provider-1'], ['patients.profiles.scope.status', 'active'], ['status', 'open'],
    ]);
    expect(chains.alerts.order.mock.calls).toEqual([['last_seen_at', { ascending: false }], ['id', { ascending: true }]]);
    expect(chains.alerts.range).toHaveBeenCalledExactlyOnceWith(25, 49);
    expect(chains.work_items.in).toHaveBeenCalledExactlyOnceWith('source_id', ['alert-1']);
  });

  it('omits the status constraint for the all filter', async () => {
    const { supabase, chains } = client();
    await getAlerts(supabase, 'provider-1', 'all');
    expect(chains.alerts.eq.mock.calls).toEqual([
      ['patients.profiles.scope.provider_id', 'provider-1'], ['patients.profiles.scope.status', 'active'],
    ]);
  });
});


describe('large provider panels', () => {
  it('reads every linked ID, while the inbox and its exact badge keep their database-side scope', async () => {
    const links = Array.from({ length: 1051 }, (_, i) => {
      const suffix = String(i).padStart(4, '0');
      return { id: `link-${suffix}`, patient_id: `patient-${suffix}` };
    });
    const cursors: Array<string | null> = [];
    const paths: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const q = url.searchParams;
      paths.push(url.pathname);
      if (url.pathname.endsWith('/provider_patient_links')) {
        expect(q.get('provider_id')).toBe('eq.provider-1');
        expect(q.get('status')).toBe('eq.active');
        expect(q.get('order')).toBe('id.asc');
        const after = q.get('id')?.replace(/^gt\./, '') ?? null;
        cursors.push(after);
        return Response.json(links.filter(link => after === null || link.id > after).slice(0, Number(q.get('limit'))));
      }
      if (url.pathname.endsWith('/work_items')) return Response.json([]);
      expect(url.pathname).toBe('/rest/v1/alerts');
      expect(q.get('patients.profiles.scope.provider_id')).toBe('eq.provider-1');
      expect(q.get('patients.profiles.scope.status')).toBe('eq.active');
      expect(q.has('patient_id')).toBe(false);
      expect(q.get('status')).toBe('eq.open');
      if (init?.method === 'HEAD') {
        expect(q.get('severity')).toBe('in.(critical,warning)');
        return new Response(null, { headers: { 'Content-Range': '0-0/1051' } });
      }
      expect(q.get('order')).toBe('last_seen_at.desc,id.asc');
      expect(q.get('offset')).toBe('1050');
      return Response.json([{ id: 'last-alert', patient_id: 'patient-1050', patients: { profiles: { full_name: 'Synthetic last patient' } } }],
        { headers: { 'Content-Range': '1050-1050/1051' } });
    };
    const db = createClient('http://127.0.0.1:19999', 'unit-fixture', { global: { fetch: fakeFetch }, auth: { persistSession: false } });
    const ids = await getLinkedPatientIds(db, 'provider-1');
    expect(ids).toHaveLength(1051);
    expect(ids.at(-1)).toBe('patient-1050');
    expect(cursors).toEqual([null, 'link-0249', 'link-0499', 'link-0749', 'link-0999']);
    paths.length = 0;
    const inbox = await getAlerts(db, 'provider-1', 'open', { offset: 1050, limit: 25 });
    expect(inbox).toMatchObject({ total: 1051, alerts: [{ patient_id: 'patient-1050', patient_name: 'Synthetic last patient' }] });
    expect(await getUrgentAlertCount(db, 'provider-1')).toBe(1051);
    expect(paths).toEqual(['/rest/v1/alerts', '/rest/v1/work_items', '/rest/v1/alerts']);
  });

  it.each([
    { result: { error: null, count: 0 }, expected: 0 },
    { result: { error: null, count: null }, expected: null },
    { result: { error: { message: 'unavailable' }, count: null }, expected: null },
  ])('keeps zero distinct from an unavailable count', async ({ result, expected }) => {
    const { supabase } = client({ alerts: { ...result, data: null } });
    await expect(getUrgentAlertCount(supabase, 'provider-1')).resolves.toBe(expected);
  });
});
