import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc, revalidatePath } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('next/cache', () => ({ revalidatePath }));
import { acknowledgeCareRequest, applyCareRequest, cancelCareRequest, loadPendingCareRequests,
  prepareCareRequest, recoverCareRequest } from '@/lib/care-workflow/actions';
import { CARE_UNCONFIRMED, type CareRequestInput, type CareRequestState } from '@/lib/care-workflow/types';
const id = (n: number) => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actor_id: id(1), patient_id: id(2), organization_id: id(3) };
const input: CareRequestInput = { ...scope, request_id: id(4), work_item_id: id(5), payload: {
  kind: 'laboratory_order', source: 'external_documented', purpose: '  Documented request  ', evidence: 'Synthetic evidence',
  occurred_at: '2026-09-29T12:00:00Z', next_review_at: '2026-10-01T12:00:00Z', analytes: ['potassium'],
} };
const prepared: CareRequestState = { ...input, state: 'prepared', recorded_at: '2026-09-29T13:00:00.123456+00:00',
  acknowledged_at: null, receipt: null };
const applied: CareRequestState = { ...prepared, state: 'applied', receipt: {
  request_id: input.request_id, work_item_id: input.work_item_id, event_id: id(6), stage: 'requested',
  workflow_revision: '1', recorded_at: prepared.recorded_at, acceptance_recorded: false, external_transmission_confirmed: false,
} };
const ok = (data: unknown) => ({ data, error: null });
const operations = [prepareCareRequest, recoverCareRequest, applyCareRequest, cancelCareRequest, acknowledgeCareRequest];
beforeEach(() => {
  vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: scope.actor_id }, supabase: { rpc } });
  rpc.mockResolvedValue(ok(prepared));
});
describe('care request action identity and receipt boundaries', () => {
  it('prepares exactly the frozen payload and does not apply automatically', async () => {
    expect(await prepareCareRequest(input)).toEqual({ data: prepared, error: null });
    expect(authorize).toHaveBeenCalledWith('provider');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('prepare_care_workflow_request', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_patient_id: input.patient_id,
      p_organization_id: input.organization_id, p_payload: input.payload,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([false, 'changed'])('denies every operation before RPC on authorization/session %s', async (mode) => {
    authorize.mockResolvedValue(mode === false ? { authorized: false } : { authorized: true, user: { id: id(99) }, supabase: { rpc } });
    for (const operation of operations) expect((await operation(input)).data).toBeNull();
    expect((await loadPendingCareRequests({ ...scope, after: null })).data).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'request_id'])('rejects wrong %s before state change', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: id(99) }));
    expect((await applyCareRequest(input)).data).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_workflow_request', { p_request_id: input.request_id });
  });
  it('rejects even a whitespace change in the recovered payload', async () => {
    rpc.mockResolvedValue(ok({ ...prepared, payload: { ...input.payload, purpose: input.payload.purpose.trim() } }));
    expect((await cancelCareRequest(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('applies only after a matching read and validates the committed receipt', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(applied));
    expect(await applyCareRequest(input)).toEqual({ data: applied, error: null });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_care_workflow_request', 'apply_care_workflow_request']);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('recovery remains read-only, including an applied receipt', async () => {
    rpc.mockResolvedValue(ok(applied));
    expect(await recoverCareRequest(input)).toEqual({ data: applied, error: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_workflow_request', { p_request_id: input.request_id });
  });
  it('preserves an applied receipt when late cancellation loses the race', async () => {
    rpc.mockResolvedValue(ok(applied));
    expect(await cancelCareRequest(input)).toEqual({ data: applied, error: null });
  });
  it('accepts cancellation without implying care completion', async () => {
    const cancelled = { ...prepared, state: 'cancelled' };
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(cancelled));
    expect((await cancelCareRequest(input)).data?.state).toBe('cancelled');
  });
  it('acknowledgement requires an applied receipt and a recorded acknowledgement', async () => {
    rpc.mockResolvedValue(ok(applied)); expect((await acknowledgeCareRequest(input)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...applied, acknowledged_at: prepared.recorded_at }));
    expect((await acknowledgeCareRequest(input)).data?.acknowledged_at).toBe(prepared.recorded_at);
  });
  it('never invalidates the current request panel through a cache refresh', async () => {
    rpc.mockResolvedValue(ok(applied)); revalidatePath.mockImplementation(() => { throw new Error('cache unavailable'); });
    expect((await applyCareRequest(input)).data).toEqual(applied);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...applied, receipt: null }, { ...applied, receipt: { ...applied.receipt, acceptance_recorded: true } }])('rejects malformed success %#', async (data) => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(data));
    expect((await applyCareRequest(input)).data).toBeNull();
  });
  it.each(['reject', 'error'])('contains %s and does not retry or expose database details', async (mode) => {
    if (mode === 'reject') rpc.mockRejectedValue(new Error('private diagnostic'));
    else rpc.mockResolvedValue({ data: applied, error: { message: 'private diagnostic' } });
    expect(await prepareCareRequest(input)).toEqual({ data: null, error: CARE_UNCONFIRMED });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid input before authorization', async () => {
    for (const operation of operations) expect((await operation({ ...input, request_id: 'invalid' })).data).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  });
});
describe('pending care request pagination', () => {
  it('accepts 25 and a final tail, preserving sorted identities', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...prepared, request_id: id(i + 10) }));
    rpc.mockResolvedValueOnce(ok({ items, next_cursor: id(34) }));
    expect((await loadPendingCareRequests({ ...scope, after: null })).data?.items).toHaveLength(25);
    rpc.mockResolvedValueOnce(ok({ items: [{ ...prepared, request_id: id(35) }], next_cursor: null }));
    expect((await loadPendingCareRequests({ ...scope, after: id(34) })).data?.items).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith('list_pending_care_requests', { p_organization_id: scope.organization_id,
      p_patient_id: scope.patient_id, p_after: id(34) });
  });
  it('only reports empty after a validated explicit empty result', async () => {
    rpc.mockResolvedValue(ok({ items: [], next_cursor: null }));
    expect((await loadPendingCareRequests({ ...scope, after: null })).data?.items).toEqual([]);
  });
  it.each([null, {}, { items: [], next_cursor: id(4) }, { items: [prepared, prepared], next_cursor: null },
    { items: [{ ...prepared, actor_id: id(99) }], next_cursor: null },
    { items: [{ ...prepared, organization_id: id(99) }], next_cursor: null },
    { items: [{ ...prepared, patient_id: id(99) }], next_cursor: null },
    { items: [{ ...prepared, state: 'cancelled' }], next_cursor: null },
    { items: [{ ...applied, acknowledged_at: prepared.recorded_at }], next_cursor: null },
    { items: [prepared], next_cursor: id(99) }])('fails closed on malformed page %#', async (page) => {
    rpc.mockResolvedValue(ok(page));
    expect((await loadPendingCareRequests({ ...scope, after: null })).data).toBeNull();
  });
  it('rejects a nonadvancing page', async () => {
    rpc.mockResolvedValue(ok({ items: [prepared], next_cursor: null }));
    expect((await loadPendingCareRequests({ ...scope, after: input.request_id })).data).toBeNull();
  });
});
