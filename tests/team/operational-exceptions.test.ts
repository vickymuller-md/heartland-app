import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOperationalExceptions } from '@/lib/team/exception-queries';
import { loadOperationalExceptions } from '@/lib/team/exception-actions';
import { EXCEPTION_LOAD_ERROR, EXCEPTION_REASONS } from '@/lib/team/operational-exceptions';
import type { SupabaseClient } from '@supabase/supabase-js';

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('server-only', () => ({}));
const org = '49000000-0000-4000-8000-000000000001';
const empty = { items: [], next_cursor: null, counts: null, detail_authorized: true };
const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient;
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: empty, error: null }); });

describe('scoped operational exception reads', () => {
  it('uses only the authenticated projection with a bounded stable cursor', async () => {
    expect(await getOperationalExceptions(client, { organizationId: org, after: 'vitals:receipt' })).toEqual({ data: empty, error: null });
    expect(rpc).toHaveBeenCalledWith('get_operational_exceptions', { p_organization_id: org, p_after: 'vitals:receipt', p_limit: 25 });
  });
  it.each([null, {}, { ...empty, counts: {} }, { ...empty, items: [{}] }, { ...empty, snapshot: 'private' },
    { ...empty, detail_authorized: false, next_cursor: 'private-cursor' }])('rejects unknown or unexpected response shape %j', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect(await getOperationalExceptions(client, { organizationId: org })).toEqual({ data: null, error: EXCEPTION_LOAD_ERROR });
  });
  it('does not call the database for invalid organization or oversized cursor', async () => {
    for (const input of [{ organizationId: 'invalid' }, { organizationId: org, after: 'x'.repeat(201) }]) {
      expect((await getOperationalExceptions(client, input)).data).toBeNull();
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['rpc', 'thrown'])('does not expose raw %s errors or claim no work', async (kind) => {
    if (kind === 'rpc') rpc.mockResolvedValue({ data: empty, error: { message: 'private endpoint' } });
    else rpc.mockRejectedValue(new Error('private endpoint'));
    expect(await getOperationalExceptions(client, { organizationId: org })).toEqual({ data: null, error: EXCEPTION_LOAD_ERROR });
  });
  it('reauthorizes every action and never queries after an authentication failure', async () => {
    authorize.mockResolvedValue({ authorized: false, error: 'MFA required' });
    expect((await loadOperationalExceptions({ organizationId: org, after: null })).data).toBeNull();
    expect(authorize).toHaveBeenCalledWith('provider');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses the user client, not a service bypass', async () => {
    authorize.mockResolvedValue({ authorized: true, supabase: client });
    expect(await loadOperationalExceptions({ organizationId: org, after: null })).toEqual({ data: empty, error: null });
  });
  it('reports unavailable if authorization itself throws', async () => {
    authorize.mockRejectedValue(new Error('private auth response'));
    expect(await loadOperationalExceptions({ organizationId: org, after: null })).toEqual({ data: null, error: EXCEPTION_LOAD_ERROR });
  });
  const notification = { key: `notification:${org}`, category: 'notification', patient_id: org, work_item_id: org,
    state: 'pending', reasons: ['critical_created'], recorded_at: '2026-09-24T12:00:00Z' };
  const routing = { ...notification, key: `notification_routing:${org}`, category: 'notification_routing',
    state: 'needs_review', reasons: ['critical_new_flag'] };
  it.each(['critical_created', 'critical_escalated', 'critical_reassigned'])('accepts pending %s without claiming delivery', async (event) => {
    const data = { ...empty, items: [{ ...notification, reasons: [event] }] };
    rpc.mockResolvedValue({ data, error: null });
    expect((await getOperationalExceptions(client, { organizationId: org })).data).toEqual(data);
  });
  it.each(Object.keys(EXCEPTION_REASONS).filter((key) => key.startsWith('captured_')))('accepts contextualized historical block %s', async (block) => {
    const data = { ...empty, items: [{ ...notification, state: 'blocked', reasons: ['critical_created', block] }] };
    rpc.mockResolvedValue({ data, error: null });
    expect((await getOperationalExceptions(client, { organizationId: org })).data).toEqual(data);
  });
  it.each(['critical_new_flag', 'closed_work_later_signal'])('accepts routing observation %s without a new episode', async (code) => {
    const data = { ...empty, items: [{ ...routing, reasons: [code] }] };
    rpc.mockResolvedValue({ data, error: null });
    expect((await getOperationalExceptions(client, { organizationId: org })).data).toEqual(data);
  });
  it.each([
    { ...notification, state: 'cancelled' }, { ...notification, state: 'sent' }, { ...notification, state: 'failed' },
    { ...notification, state: 'blocked' }, { ...notification, work_item_id: null }, { ...notification, key: 'ownership:unexpected' },
    { ...notification, recipient_id: org }, { ...notification, payload: 'private' }, { ...notification, endpoint: 'private' },
    { ...notification, reasons: ['unknown'] }, { ...notification, reasons: ['critical_created', 'captured_blocked_preference'] },
    { ...notification, state: 'blocked', reasons: ['critical_created', 'no_active_link'] },
    { ...notification, state: 'blocked', reasons: ['critical_created', 'captured_blocked_preference', 'critical_escalated'] },
    { ...notification, state: 'blocked', reasons: ['captured_blocked_preference', 'critical_created'] },
    { ...routing, state: 'pending' }, { ...routing, work_item_id: null }, { ...routing, reasons: ['critical_created'] },
    { ...routing, reasons: ['critical_new_flag', 'closed_work_later_signal'] },
    { ...routing, category: 'ownership' },
  ])('rejects inconsistent notification projection %j', async (row) => {
    rpc.mockResolvedValue({ data: { ...empty, items: [row] }, error: null });
    expect(await getOperationalExceptions(client, { organizationId: org })).toEqual({ data: null, error: EXCEPTION_LOAD_ERROR });
  });
  it('requires all eight numeric administrative counts without identifiers', async () => {
    const counts = { ownership: 0, vitals: 0, laboratory: 0, scan_capture: 0, scan_rule: 0, scan_routing: 0,
      notification: 31, notification_routing: 2 };
    const data = { ...empty, counts, detail_authorized: false };
    rpc.mockResolvedValue({ data, error: null });
    expect((await getOperationalExceptions(client, { organizationId: org })).data).toEqual(data);
    for (const invalid of [{ ...counts, recipient: org }, { ...counts, notification: -1 }, { ...counts, notification_routing: undefined }]) {
      rpc.mockResolvedValue({ data: { ...data, counts: invalid }, error: null });
      expect((await getOperationalExceptions(client, { organizationId: org })).data).toBeNull();
    }
  });
});
