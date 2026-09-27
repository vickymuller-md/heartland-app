import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc, analytics, revalidate } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), analytics: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize, authorizeProviderForPatient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: analytics }));
import { reassignWorkItem } from '@/lib/daily-loop/actions';
import { loadWorkReassignmentContext, finishWorkReassignment, loadMyReassignmentRequests } from '@/lib/daily-loop/reassignment-actions';
import { reassignmentSchema, REASSIGNMENT_UNKNOWN, REASSIGNMENT_UNAVAILABLE } from '@/lib/daily-loop/reassignment';
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = { requestId: id(1), workItemId: id(2), patientId: id(3), expectedAssignee: id(4), expectedRevision: '9007199254740993', assigneeId: id(5), reason: 'Synthetic reviewed handover' };
const receipt = { request_id: id(1), event_id: id(6), work_item_id: id(2), recorded_assignee: id(5), recorded_revision: '9007199254740994', recorded_at: '2026-09-24T12:00:00.123456+00:00', acceptance_recorded: false };
const context = { work_item_id: id(2), patient_id: id(3), current_assignee: id(4), current_revision: '9007199254740993', eligible: true, targets: [{ id: id(5), name: 'Eligible recipient' }], next_cursor: null };
const prepared = { state: 'prepared', request, receipt: null };
const applied = { state: 'applied', request, receipt };
beforeEach(() => {
  vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(7) }, supabase: { rpc } });
  rpc.mockImplementation(async (name) => ({ error: null, data: name === 'prepare_work_reassignment' ? prepared
    : name === 'recover_work_reassignment' ? null : name === 'get_work_reassignment_context' ? context : receipt }));
});

describe('recoverable ownership action', () => {
  it('preserves bigint precision and never invents an acceptance or a second event', async () => {
    expect(await reassignWorkItem(request)).toEqual({ success: true, receipt, recovery: applied });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_work_reassignment', 'reassign_work_item_recoverable']);
    expect(rpc).toHaveBeenCalledWith('reassign_work_item_recoverable', {
      p_request_id: id(1), p_work_item_id: id(2), p_expected_assignee: id(4), p_expected_revision: request.expectedRevision, p_to: id(5), p_reason: request.reason,
    });
    expect(analytics).not.toHaveBeenCalled(); expect(revalidate).not.toHaveBeenCalled();
  });
  it.each(['request_id', 'work_item_id', 'recorded_assignee', 'recorded_revision', 'acceptance_recorded'])(
    'treats mismatched %s as unconfirmed', async (field) => {
      rpc.mockResolvedValueOnce({ data: prepared, error: null }).mockResolvedValueOnce({ data: { ...receipt, [field]: field === 'acceptance_recorded' ? true : field === 'recorded_revision' ? '2' : id(99) }, error: null });
      expect(await reassignWorkItem(request)).toEqual({ success: false, status: 'unknown', error: REASSIGNMENT_UNKNOWN, recovery: prepared });
    });
  it.each([null, {}, { ...receipt, private_detail: 'must not be returned' }])('rejects missing or overbroad receipts', async (data) => {
    rpc.mockResolvedValue({ data, error: null }); expect((await reassignWorkItem(request)).success).toBe(false);
  });
  it.each(['42501', '23505', 'PGRST000', '57014'])('keeps %s ambiguous and its private message hidden', async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private synthetic diagnostic' } });
    expect(await reassignWorkItem(request)).toEqual({ success: false, status: 'unknown', error: REASSIGNMENT_UNKNOWN });
  });
  it('separates an observed revision conflict from missing confirmation', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    expect(await reassignWorkItem(request)).toMatchObject({ success: false, status: 'rejected' });
  });
  it('does not expose thrown transport failures', async () => {
    rpc.mockRejectedValue(new Error('private transport value'));
    expect(await reassignWorkItem(request)).toEqual({ success: false, status: 'unknown', error: REASSIGNMENT_UNKNOWN });
  });
  it('reauthorizes before retrying', async () => {
    authorize.mockResolvedValue({ authorized: false });
    expect((await reassignWorkItem(request)).success).toBe(false); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['-1', '1.5', '01', '', 'NaN', '9223372036854775808'])('rejects invalid revision %s without throwing', (expectedRevision) => {
    expect(reassignmentSchema.safeParse({ ...request, expectedRevision }).success).toBe(false);
  });
});

describe('current ownership preparation', () => {
  it('uses a paginated authenticated RPC and validates response identity', async () => {
    expect(await loadWorkReassignmentContext({ workItemId: id(2), after: id(8) })).toEqual({ data: context, error: null });
    expect(rpc).toHaveBeenCalledWith('get_work_reassignment_context', { p_work_item_id: id(2), p_after: id(8), p_limit: 25 });
  });
  it.each([{ ...context, work_item_id: id(99) }, { ...context, targets: Array(26).fill(context.targets[0]) }, { ...context, clinical_data: 'not allowed' }])('rejects wrong or excessive context', async (data) => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data, error: null });
    expect(await loadWorkReassignmentContext({ workItemId: id(2), after: null })).toEqual({ data: null, error: REASSIGNMENT_UNAVAILABLE });
  });
  it('does not represent failed authorization as no eligible recipients', async () => {
    authorize.mockResolvedValue({ authorized: false });
    expect(await loadWorkReassignmentContext({ workItemId: id(2), after: null })).toEqual({ data: null, error: REASSIGNMENT_UNAVAILABLE });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('durable request lifecycle', () => {
  it('does not apply a new command when another unresolved request is returned', async () => {
    const prior = { ...prepared, request: { ...request, requestId: id(90), reason: 'Earlier saved handover' } };
    rpc.mockResolvedValueOnce({ data: prior, error: null });
    expect(await reassignWorkItem(request)).toMatchObject({ success: false, recovery: prior });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each(['applied', 'seen'])('recovers %s without another apply or an automatic acknowledgment', async (state) => {
    rpc.mockResolvedValueOnce({ data: { ...applied, state }, error: null });
    expect(await reassignWorkItem(request)).toMatchObject({ success: true, receipt });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('does not apply a cancelled request', async () => {
    rpc.mockResolvedValueOnce({ data: { ...prepared, state: 'cancelled' }, error: null });
    expect(await reassignWorkItem(request)).toMatchObject({ success: false, recovery: { state: 'cancelled' } });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('keeps the committed preparation when apply throws', async () => {
    rpc.mockResolvedValueOnce({ data: prepared, error: null }).mockRejectedValueOnce(new Error('lost response'));
    expect(await reassignWorkItem(request)).toMatchObject({ success: false, recovery: prepared, status: 'unknown' });
  });
  it('recovers before loading fresh ownership, even for an applied item no longer in the queue', async () => {
    rpc.mockResolvedValueOnce({ data: applied, error: null });
    expect(await loadWorkReassignmentContext({ workItemId: id(2), after: null })).toEqual({ data: null, error: null, recovery: applied });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('requires receipt identity for explicit review and never treats a cancellation race as cancelled', async () => {
    rpc.mockResolvedValueOnce({ data: applied, error: null });
    expect(await finishWorkReassignment({ requestId: id(1), receiptId: null, cancel: true })).toEqual({ data: applied, error: null });
    rpc.mockResolvedValueOnce({ data: { ...applied, state: 'seen' }, error: null });
    expect(await finishWorkReassignment({ requestId: id(1), receiptId: id(99), cancel: false })).toEqual({ data: null, error: REASSIGNMENT_UNAVAILABLE });
  });
  it('rejects an impossible state/receipt combination', async () => {
    rpc.mockResolvedValueOnce({ data: { ...prepared, receipt }, error: null });
    expect((await reassignWorkItem(request)).success).toBe(false); expect(rpc).toHaveBeenCalledOnce();
  });
  it('keeps inaccessible own count distinct from failed loading', async () => {
    const data = { items: [], inaccessible_count: 2, next_cursor: null };
    rpc.mockResolvedValueOnce({ data, error: null });
    expect(await loadMyReassignmentRequests(id(8))).toEqual({ data, error: null });
    expect(rpc).toHaveBeenCalledWith('get_my_work_reassignment_requests', { p_after: id(8), p_limit: 25 });
    rpc.mockRejectedValueOnce(new Error('private diagnostic'));
    expect(await loadMyReassignmentRequests()).toEqual({ data: null, error: REASSIGNMENT_UNAVAILABLE });
  });
});
