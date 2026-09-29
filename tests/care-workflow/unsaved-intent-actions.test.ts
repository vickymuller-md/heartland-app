import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { acknowledgeUnsaved, applyUnsaved, cancelUnsaved, loadPendingUnsaved, loadUnsavedContext, loadUnsavedHistory,
  prepareUnsaved, recoverUnsaved } from '@/lib/care-workflow/unsaved-intent-actions';
import { unsavedInputSchema } from '@/lib/care-workflow/unsaved-intent-types';
const id = (n: number) => `bf000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const snapshot = { intent_id: id(6), recorded_at: at, submission_status: 'awaiting_save', submission_cancelled_at: null };
const input = unsavedInputSchema.parse({ ...scope, request_id: id(10), work_item_id: id(5), intent_id: id(6), expected_revision: '1', expected_ownership_revision: '3',
  payload: { snapshot, occurred_at: at, evidence: '  Original evidence  ', reason: 'Explicit unsaved cancellation', unsaved_cancellation_acknowledged: true } });
const prepared = { ...input, recorded_at: at, state: 'prepared', acknowledged_at: null, receipt: null };
const receipt = { request_id: id(10), event_id: id(11), work_item_id: id(5), intent_id: id(6), workflow_revision: '1', ownership_revision: '3',
  recorded_at: at, submission_cancelled_at: at, intent_cancelled_at: at, intention_cancelled: true, result_saved: false, result_linked: false,
  clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
const applied = { ...prepared, state: 'applied', receipt };
const context = { ...scope, work_item_id: id(5), workflow_revision: '1', ownership_revision: '3', snapshot };
const history = { work_item_id: id(5), items: [{ event_id: id(11), actor_id: id(1), intent_id: id(6), recorded_at: at, payload: input.payload, receipt }], next_cursor: null };
const read = { ...scope, work_item_id: id(5), intent_id: id(6) };
const ok = (data: unknown) => ({ data, error: null }), failed = { data: null, error: { code: '42501', message: 'private diagnostic' } };
const actions = [prepareUnsaved, recoverUnsaved, applyUnsaved, cancelUnsaved, acknowledgeUnsaved];
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(1) }, supabase: { rpc } }); rpc.mockResolvedValue(ok(prepared)); });
describe('administrative request actions', () => {
  it.each(actions)('rejects changed actor before RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(99) }, supabase: { rpc } });
    expect((await action(input)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(actions)('rejects malformed input before authorization %#', async (action) => {
    expect((await action({ ...input, intent_id: id(99) })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it.each(actions)('sanitizes thrown authorization and RPC errors %#', async (action) => {
    authorize.mockRejectedValueOnce(new Error('private diagnostic')); expect(JSON.stringify(await action(input))).not.toContain('private diagnostic');
    rpc.mockRejectedValueOnce(new Error('private diagnostic')); expect(JSON.stringify(await action(input))).not.toContain('private diagnostic');
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'intent_id', 'request_id', 'expected_revision', 'expected_ownership_revision'])('rejects substituted %s before mutation', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: key.endsWith('revision') ? '9' : id(99) }));
    expect((await applyUnsaved(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['evidence', 'reason', 'occurred_at', 'snapshot'])('rejects replaced frozen %s', async (key) => {
    const changes = { evidence: input.payload.evidence.trim(), reason: 'Changed cancellation reason', occurred_at: '2026-09-29T11:59:00Z',
      snapshot: { ...snapshot, recorded_at: '2026-09-29T11:58:00Z' } };
    rpc.mockResolvedValue(ok({ ...prepared, payload: { ...input.payload, [key]: changes[key as keyof typeof changes] } }));
    expect((await cancelUnsaved(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('uses same ID and exact SQL arguments after an unsuccessful lookup without inferring absence', async () => {
    rpc.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok(prepared)); expect((await prepareUnsaved(input)).data).toEqual(prepared);
    expect(rpc).toHaveBeenNthCalledWith(2, 'prepare_care_unsaved_intent_request', { p_request_id: id(10), p_work_item_id: id(5), p_intent_id: id(6),
      p_organization_id: id(3), p_patient_id: id(2), p_expected_revision: '1', p_expected_ownership_revision: '3', p_payload: input.payload });
  });
  it.each(['prepared', 'applied', 'cancelled'])('same-ID preparation returns historical %s without current context', async (state) => {
    const data = { ...(state === 'applied' ? applied : prepared), state };
    rpc.mockResolvedValue(ok(data)); expect((await prepareUnsaved(input)).data).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_unsaved_intent_request', { p_request_id: id(10) });
  });
  it.each([applyUnsaved, cancelUnsaved, acknowledgeUnsaved])('does not mutate after failed recovery %#', async (action) => {
    rpc.mockResolvedValue(failed); expect((await action(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('requires terminal results and reports cancellation that lost to apply honestly', async () => {
    rpc.mockResolvedValue(ok(prepared)); expect((await applyUnsaved(input)).data).toBeNull(); expect((await cancelUnsaved(input)).data).toBeNull();
    rpc.mockResolvedValue(ok(applied)); expect((await cancelUnsaved(input)).data?.state).toBe('applied');
    expect((await applyUnsaved(input)).data?.receipt?.workflow_revision).toBe('1'); expect((await acknowledgeUnsaved(input)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...applied, acknowledged_at: at })); expect((await acknowledgeUnsaved(input)).data?.acknowledged_at).toBe(at);
  });
  it('private recovery has no current owner, work or clinical-context lookup', async () => {
    expect((await recoverUnsaved(input)).data).toEqual(prepared);
    expect(authorize).toHaveBeenCalledExactlyOnceWith('provider'); expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_unsaved_intent_request', { p_request_id: id(10) });
  });
});
describe('administrative current readers', () => {
  it('loads only the dedicated exact-target context', async () => {
    rpc.mockResolvedValue(ok(context)); expect((await loadUnsavedContext(read)).data).toEqual(context);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_unsaved_intent_context', { p_work_item_id: id(5), p_intent_id: id(6) });
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'snapshot'])('rejects changed context %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...context, [key]: key === 'snapshot' ? { ...snapshot, intent_id: id(99) } : id(99) }));
    expect((await loadUnsavedContext(read)).data).toBeNull();
  });
  it.each(['actor_id', 'organization_id', 'patient_id'])('rejects foreign private-list %s', async (key) => {
    rpc.mockResolvedValue(ok({ items: [{ ...prepared, [key]: id(99) }], next_cursor: null }));
    expect((await loadPendingUnsaved({ ...scope, after: null })).data).toBeNull();
  });
  it('validates private-list cursor and sends only requested organization/patient', async () => {
    rpc.mockResolvedValue(ok({ items: [prepared], next_cursor: null }));
    expect((await loadPendingUnsaved({ ...scope, after: id(9) })).data?.items).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith('list_pending_care_unsaved_intent_requests', { p_organization_id: id(3), p_patient_id: id(2), p_after: id(9) });
    expect((await loadPendingUnsaved({ ...scope, after: id(10) })).data).toBeNull();
  });
  it.each(['patient_id', 'organization_id', 'work_item_id'])('does not read history after a substituted work scope %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...scope, work_item_id: id(5), [key]: id(99) }));
    expect((await loadUnsavedHistory({ ...scope, work_item_id: id(5), after: null })).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('history uses exact work/cursor and permits historical authors other than the current user', async () => {
    const value = { ...history, items: [{ ...history.items[0], actor_id: id(99) }] };
    rpc.mockResolvedValueOnce(ok(context)).mockResolvedValueOnce(ok(value));
    expect((await loadUnsavedHistory({ ...scope, work_item_id: id(5), after: id(9) })).data).toEqual(value);
    expect(rpc).toHaveBeenNthCalledWith(2, 'list_care_unsaved_intent_history', { p_work_item_id: id(5), p_after: id(9) });
    rpc.mockResolvedValueOnce(ok(context)).mockResolvedValueOnce(ok(value));
    expect((await loadUnsavedHistory({ ...scope, work_item_id: id(5), after: id(11) })).data).toBeNull();
  });
  it('sanitizes reader failures and prevents malformed or wrong-actor queries', async () => {
    expect((await loadUnsavedContext({ ...read, intent_id: 'bad' })).data).toBeNull();
    expect((await loadPendingUnsaved({ ...scope, after: 'bad' })).data).toBeNull();
    expect((await loadUnsavedHistory({ ...scope, work_item_id: 'bad', after: null })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
    authorize.mockResolvedValue({ authorized: true, user: { id: id(99) }, supabase: { rpc } });
    expect((await loadUnsavedContext(read)).data).toBeNull(); expect((await loadPendingUnsaved({ ...scope, after: null })).data).toBeNull();
    expect((await loadUnsavedHistory({ ...scope, work_item_id: id(5), after: null })).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
});
