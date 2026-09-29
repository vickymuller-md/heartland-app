import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { acknowledgeHuman, applyHuman, cancelHuman, loadHumanContext, loadPendingHuman, prepareHuman, recoverHuman } from '@/lib/care-workflow/human-actions';
import { humanInputSchema } from '@/lib/care-workflow/human-types';

const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123456Z', due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const common = { occurred_at: at, evidence: '  Synthetic documented evidence  ', next_action: 'Review remaining evidence', next_review_at: due };
const basis = { kind: 'referral', composition_event_id: null, sources: [], processing: [], operational_event: {
  event_id: id(8), revision: '2', occurred_at: at, recorded_at: at, command: 'record_report', payload: { ...common, details: { report_reference: 'Synthetic report' } } } };
const input = humanInputSchema.parse({ ...scope, request_id: id(10), work_item_id: id(5), expected_revision: '3', expected_ownership_revision: '1',
  command: 'record_review', basis, basis_signature: 'a'.repeat(64), payload: { ...common, details: { decision: '  Decision evidence  ', limitations: 'Partial evidence remains' } } });
const prepared = { ...input, state: 'prepared', recorded_at: at, acknowledged_at: null, receipt: null };
const applied = { ...prepared, state: 'applied', receipt: { request_id: input.request_id, work_item_id: input.work_item_id, event_id: id(20),
  command: input.command, workflow_revision: '4', ownership_revision: '1', stage: 'report_received', recorded_at: at, basis: input.basis,
  basis_signature: input.basis_signature, exception_id: null, due_at: due, clinical_review_recorded: true, addresses_current_review: false,
  communication_confirmed: false, care_completed: false } };
const context = { ...scope, work_item_id: id(5), workflow_revision: '3', ownership_revision: '1', kind: 'referral', stage: 'report_received',
  command: 'record_review', basis, basis_signature: input.basis_signature, latest_review: null };
const read = { ...scope, work_item_id: id(5), command: 'record_review' as const };
const ok = (data: unknown) => ({ data, error: null });
const failure = { data: null, error: { message: 'private diagnostic', code: '42501' } };
const actions = [prepareHuman, recoverHuman, applyHuman, cancelHuman, acknowledgeHuman];
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(1) }, supabase: { rpc } }); rpc.mockResolvedValue(ok(prepared)); });

describe('exact human evidence server actions', () => {
  it.each(actions)('rejects a changed actor before any RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(999) }, supabase: { rpc } });
    expect((await action(input)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(actions)('rejects malformed input before authorization %#', async (action) => {
    expect((await action({ ...input, basis_signature: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it.each(actions)('does not expose auth or RPC exceptions %#', async (action) => {
    authorize.mockRejectedValueOnce(new Error('private diagnostic'));
    expect(JSON.stringify(await action(input))).not.toContain('private diagnostic');
    rpc.mockRejectedValueOnce(new Error('private diagnostic'));
    expect((await action(input)).data).toBeNull();
  });
  it.each(['prepared', 'applied', 'cancelled'])('replays exact %s without revalidating expired dates or heads', async (state) => {
    const old = { ...input, payload: { ...input.payload, next_review_at: '2020-01-01T00:00:00Z' } };
    const receipt = { ...(state === 'applied' ? applied : prepared), ...old, state };
    rpc.mockResolvedValue(ok(receipt)); expect((await prepareHuman(old)).data).toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_request', { p_request_id: input.request_id });
  });
  it('uses same-ID SQL after unsuccessful lookup; never treats failed read as proof of absence', async () => {
    rpc.mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(prepared));
    expect((await prepareHuman(input)).data).toEqual(prepared);
    expect(rpc).toHaveBeenNthCalledWith(2, 'prepare_care_human_request', { p_request_id: input.request_id,
      p_work_item_id: input.work_item_id, p_organization_id: input.organization_id, p_patient_id: input.patient_id,
      p_expected_revision: '3', p_expected_ownership_revision: '1', p_command: input.command,
      p_basis: input.basis, p_basis_signature: input.basis_signature, p_payload: input.payload });
  });
  it.each([applyHuman, cancelHuman, acknowledgeHuman])('does not mutate after failed exact recovery %#', async (action) => {
    rpc.mockResolvedValue(failure); expect((await action(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'request_id', 'expected_revision', 'expected_ownership_revision', 'basis_signature'])('refuses mismatched %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: key.includes('revision') ? '8' : key === 'basis_signature' ? 'b'.repeat(64) : id(999) }));
    expect((await applyHuman(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('does not trim or replace frozen clinical text', async () => {
    rpc.mockResolvedValue(ok({ ...prepared, payload: { ...input.payload, evidence: input.payload.evidence.trim() } }));
    expect((await cancelHuman(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('requires a matching applied receipt and exposes cancel-lost-as-applied honestly', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(applied)); expect((await applyHuman(input)).data).toEqual(applied);
    rpc.mockResolvedValue(ok(applied)); expect((await cancelHuman(input)).data?.state).toBe('applied');
    rpc.mockResolvedValue(ok(prepared)); expect((await applyHuman(input)).data).toBeNull(); expect((await cancelHuman(input)).data).toBeNull();
  });
  it('requires applied plus acknowledged state for ACK', async () => {
    rpc.mockResolvedValue(ok(applied)); expect((await acknowledgeHuman(input)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...applied, acknowledged_at: at })); expect((await acknowledgeHuman(input)).data?.acknowledged_at).toBe(at);
  });
  it.each([{ communication_confirmed: true }, { care_completed: true }, { workflow_revision: '5' }, { stage: 'requested' }, { basis_signature: 'b'.repeat(64) }])('rejects inconsistent returned proof %#', async (change) => {
    rpc.mockResolvedValue(ok({ ...applied, receipt: { ...applied.receipt, ...change } }));
    expect((await recoverHuman(input)).data).toBeNull();
  });
  it('uses one authorized client and reads no current workflow or clinical capability for recovery', async () => {
    expect((await recoverHuman(input)).data).toEqual(prepared);
    expect(authorize).toHaveBeenCalledExactlyOnceWith('provider'); expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_request', { p_request_id: id(10) });
  });
});
describe('human evidence and recovery reads', () => {
  it('loads a fully decoded scoped evidence snapshot', async () => {
    rpc.mockResolvedValue(ok(context)); expect((await loadHumanContext(read)).data).toEqual(context);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_context', { p_work_item_id: id(5), p_command: 'record_review' });
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'command'])('rejects changed context %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...context, [key]: key === 'command' ? 'record_contact' : id(999) })); expect((await loadHumanContext(read)).data).toBeNull();
  });
  it.each(['context', 'pending'])('rejects changed actor before %s RPC', async (kind) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(999) }, supabase: { rpc } });
    expect((await (kind === 'context' ? loadHumanContext(read) : loadPendingHuman({ ...scope, after: null }))).data).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects invalid reads before auth', async () => {
    expect((await loadHumanContext({ ...read, work_item_id: 'bad' })).data).toBeNull();
    expect((await loadPendingHuman({ ...scope, after: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it('reads exactly 25 plus an empty tail without inventing completion', async () => {
    const rows = Array.from({ length: 25 }, (_, n) => ({ ...prepared, request_id: id(100 + n) }));
    rpc.mockResolvedValueOnce(ok({ items: rows, next_cursor: id(124) })).mockResolvedValueOnce(ok({ items: [], next_cursor: null }));
    expect((await loadPendingHuman({ ...scope, after: null })).data?.next_cursor).toBe(id(124));
    expect((await loadPendingHuman({ ...scope, after: id(124) })).data).toEqual({ items: [], next_cursor: null });
    expect(rpc).toHaveBeenLastCalledWith('list_pending_care_human_requests', { p_organization_id: id(3), p_patient_id: id(2), p_after: id(124) });
  });
  it.each(['actor_id', 'organization_id', 'patient_id'])('refuses a pending page for another %s', async (key) => {
    rpc.mockResolvedValue(ok({ items: [{ ...prepared, [key]: id(999) }], next_cursor: null }));
    expect((await loadPendingHuman({ ...scope, after: null })).data).toBeNull();
  });
  it.each([
    { items: [prepared, prepared], next_cursor: null }, { items: [prepared], next_cursor: id(10) },
    { items: [{ ...prepared, state: 'cancelled' }], next_cursor: null },
    { items: [{ ...applied, acknowledged_at: at }], next_cursor: null },
  ])('rejects malformed pending page %#', async (data) => {
    rpc.mockResolvedValue(ok(data)); expect((await loadPendingHuman({ ...scope, after: null })).data).toBeNull();
  });
  it('rejects a nonforward page and hides failed lookup diagnostics', async () => {
    rpc.mockResolvedValue(ok({ items: [prepared], next_cursor: null })); expect((await loadPendingHuman({ ...scope, after: id(10) })).data).toBeNull();
    rpc.mockResolvedValue(failure); expect(JSON.stringify(await loadHumanContext(read))).not.toContain('private diagnostic');
    expect((await loadPendingHuman({ ...scope, after: null })).data).toBeNull();
  });
});
