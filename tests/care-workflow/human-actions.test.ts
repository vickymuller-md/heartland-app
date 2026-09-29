import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { acknowledgeHuman, applyHuman, cancelHuman, loadHumanContext, loadSourceResolutionContext, loadClosureContext, loadPendingHuman, prepareHuman, recoverHuman } from '@/lib/care-workflow/human-actions';
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
describe('exact changed-source server actions', () => {
  const head = { version_id: id(46), revision: '2', status: 'corrected', effective_lab_result_id: id(47), value: '4.2', collected_at: at };
  const target = { invalidation_id: id(50), entry_id: id(41), composition_event_id: id(40), composition_revision: '2', analyte: 'potassium',
    root_id: id(42), observed_version_id: id(44), change_version_id: id(46), change_revision: '2', change_status: 'corrected',
    change_recorded_at: at, recorded_at: at, head, head_recorded_at: at };
  const basis = { kind: 'laboratory_order', composition_event_id: id(40), operational_event: null,
    sources: [{ analyte: 'potassium', entry_id: id(41), root_id: id(42), authority_organization_id: id(3), original_lab_result_id: id(43),
      observed_version_id: id(44), head, evaluation_status: null, quality: 'available' }], processing: [{ lab_result_id: id(47), evaluation: null }] };
  const value = humanInputSchema.parse({ ...input, basis, expected_revision: '4', command: 'resolve_source_invalidation', payload: { ...common, details: {
    invalidation: target, review_event_id: id(70), contact_event_id: id(71), disposition: 'retained_in_current_composition',
    resolution_reason: 'Source explicitly reconciled', source_reviewed: true, change_addressed_in_contact: true,
    source_review_evidence: 'Reviewed this exact source', source_communication_evidence: 'Discussed this exact source' } } });
  const frozen = { ...prepared, ...value };
  const done = { ...frozen, state: 'applied', receipt: { ...applied.receipt, command: value.command, stage: 'result_received', basis,
    workflow_revision: '5', clinical_review_recorded: false, resolved_invalidation_id: id(50), resolution_event_id: id(20),
    source_review_attested: true, source_contact_attested: true } };
  const data = { ...context, kind: 'laboratory_order', stage: 'result_received', command: value.command, basis,
    workflow_revision: '4', invalidation: target, latest_review: null, contact: null };
  const read = { ...scope, work_item_id: id(5), invalidation_id: id(50) };
  it('uses only the dedicated authorized reader and allows honest missing prerequisites', async () => {
    rpc.mockResolvedValue(ok(data)); expect((await loadSourceResolutionContext(read)).data).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_source_resolution_context', { p_work_item_id: id(5), p_invalidation_id: id(50) });
  });
  it.each(['actor_id', 'patient_id', 'organization_id', 'work_item_id', 'invalidation'])('rejects changed target context %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...data, [key]: key === 'invalidation' ? { ...target, invalidation_id: id(99) } : id(99) }));
    expect((await loadSourceResolutionContext(read)).data).toBeNull();
  });
  it('denies malformed, generic fourth-command and changed-actor reads before RPC', async () => {
    expect((await loadSourceResolutionContext({ ...read, invalidation_id: 'bad' })).data).toBeNull();
    expect((await loadHumanContext({ ...scope, work_item_id: id(5), command: 'resolve_source_invalidation' } as never)).data).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockResolvedValue({ authorized: true, user: { id: id(99) }, supabase: { rpc } });
    expect((await loadSourceResolutionContext(read)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it('keeps private error details out of the target reader', async () => {
    rpc.mockRejectedValue(new Error('private diagnostic')); expect(JSON.stringify(await loadSourceResolutionContext(read))).not.toContain('private diagnostic');
  });
  it('prepares exactly the frozen source attestation after same-ID lookup', async () => {
    rpc.mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(frozen)); expect((await prepareHuman(value)).data).toEqual(frozen);
    expect(rpc.mock.calls[1]).toEqual(['prepare_care_human_request', expect.objectContaining({ p_command: value.command, p_payload: value.payload })]);
  });
  it.each(actions)('preserves expected actor for source operation %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(99) }, supabase: { rpc } });
    expect((await action(value)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['source_review_evidence', 'source_communication_evidence', 'resolution_reason', 'contact_event_id'])('rejects replaced frozen %s', async (key) => {
    const changed = structuredClone(frozen); Object.assign(changed.payload.details, { [key]: key === 'contact_event_id' ? id(99) : 'Changed statement' });
    rpc.mockResolvedValue(ok(changed)); expect((await applyHuman(value)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('recovers terminal source receipts with expired deadlines and no fresh context', async () => {
    const old = { ...value, payload: { ...value.payload, next_review_at: '2020-01-01T00:00:00Z' } };
    rpc.mockResolvedValue(ok({ ...done, payload: old.payload })); expect((await prepareHuman(old)).data?.state).toBe('applied');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_request', { p_request_id: value.request_id });
  });
  it('keeps lost cancellation/ACK distinct and includes the fourth variant in recovery', async () => {
    rpc.mockResolvedValue(ok(done)); expect((await cancelHuman(value)).data?.state).toBe('applied'); expect((await acknowledgeHuman(value)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...done, acknowledged_at: at })); expect((await acknowledgeHuman(value)).data?.acknowledged_at).toBe(at);
    rpc.mockResolvedValue(ok({ items: [frozen], next_cursor: null })); expect((await loadPendingHuman({ ...scope, after: null })).data?.items[0].command).toBe(value.command);
  });
});
describe.each(['close_success', 'close_without_completion'] as const)('explicit %s actions', (command) => {
  const snapshot = { exceptions: [], invalidations: [], known_invalidation_ids: [], prepared_intents: [] };
  const value = humanInputSchema.parse({ ...input, command, expected_revision: '4', payload: { occurred_at: at, evidence: 'Explicit closure evidence',
    details: { snapshot, outcome: 'Documented workflow outcome', ...(command === 'close_success'
      ? { review_event_id: id(20), contact_event_id: id(21), workflow_completed: true, review_contact_accepted: true }
      : { disposition: 'transferred', reason: 'Non-completion at this service', declarations: [] }) } } });
  const frozen = { ...prepared, ...value };
  const done = { ...frozen, state: 'applied', receipt: { request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(22),
    command, workflow_revision: '5', ownership_revision: '1', stage: 'report_received', recorded_at: at, closed_at: at, basis,
    basis_signature: value.basis_signature, work_closed: true, clinical_review_recorded: false, addresses_current_review: false,
    communication_confirmed: false, care_completed: command === 'close_success', completion_outcome: command === 'close_success' ? 'documented_workflow_completion' : 'transferred' } };
  const read = { ...scope, work_item_id: id(5), command };
  const data = { ...context, command, workflow_revision: '4', snapshot, contact: null };
  it('uses the dedicated scoped context even when prerequisites are missing', async () => {
    rpc.mockResolvedValue(ok(data)); expect((await loadClosureContext(read)).data).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_closure_context', { p_work_item_id: id(5), p_command: command });
  });
  it.each(['actor_id', 'patient_id', 'organization_id', 'work_item_id', 'command'])('rejects changed context %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...data, [key]: key === 'command' ? 'record_review' : id(99) })); expect((await loadClosureContext(read)).data).toBeNull();
  });
  it('rejects generic or malformed closure context before authentication', async () => {
    expect((await loadHumanContext(read as never)).data).toBeNull(); expect((await loadClosureContext({ ...read, work_item_id: 'bad' })).data).toBeNull();
    expect(authorize).not.toHaveBeenCalled();
  });
  it.each(actions)('checks expected actor for closure operation %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(99) }, supabase: { rpc } });
    expect((await action(value)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves frozen closure payload on same-ID preparation', async () => {
    rpc.mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(frozen)); expect((await prepareHuman(value)).data).toEqual(frozen);
    expect(rpc.mock.calls[1]).toEqual(['prepare_care_human_request', expect.objectContaining({ p_command: command, p_payload: value.payload })]);
    expect(value.payload).not.toHaveProperty('next_review_at');
  });
  it.each(['outcome', 'snapshot'])('rejects replaced frozen closure %s before applying', async (key) => {
    const changed = structuredClone(frozen); Object.assign(changed.payload.details, { [key]: key === 'outcome' ? 'Changed outcome' : { ...snapshot, known_invalidation_ids: [id(99)] } });
    rpc.mockResolvedValue(ok(changed)); expect((await applyHuman(value)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('recovers terminal result and ACK without rereading current context or deciding closure again', async () => {
    rpc.mockResolvedValue(ok(done)); expect((await prepareHuman(value)).data).toEqual(done);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_request', { p_request_id: value.request_id });
    expect((await cancelHuman(value)).data?.state).toBe('applied'); expect((await acknowledgeHuman(value)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...done, acknowledged_at: at })); expect((await acknowledgeHuman(value)).data?.acknowledged_at).toBe(at);
  });
  it('rejects old deadline-bearing receipts for a closure', async () => {
    rpc.mockResolvedValue(ok({ ...done, receipt: { ...done.receipt, due_at: due } })); expect((await recoverHuman(value)).data).toBeNull();
  });
  it('includes closure in the existing private recovery family', async () => {
    rpc.mockResolvedValue(ok({ items: [frozen], next_cursor: null })); expect((await loadPendingHuman({ ...scope, after: null })).data?.items[0].command).toBe(command);
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

describe('exact barrier resolution server actions', () => {
  const exception = { exception_id: id(30), origin_event_id: id(31), human_origin_event_id: null, origin_revision: '2', origin_occurred_at: at,
    code: 'report_missing', reason: 'Missing report record', next_action: common.next_action, next_review_at: due, recorded_at: at };
  const resolution = humanInputSchema.parse({ ...input, command: 'resolve_exception', payload: { ...common,
    details: { exception, disposition: 'clinical_non_delivery', resolution_reason: 'Professional non-delivery decision' } } });
  const frozen = { ...prepared, ...resolution };
  const done = { ...applied, ...resolution, receipt: { ...applied.receipt, command: 'resolve_exception', clinical_review_recorded: false,
    resolved_exception_id: id(30), resolution_event_id: applied.receipt.event_id } };
  it('loads exact open targets using the expected actor and command', async () => {
    const data = { ...context, command: 'resolve_exception', exceptions: [exception] };
    rpc.mockResolvedValue(ok(data)); expect((await loadHumanContext({ ...read, command: 'resolve_exception' })).data).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_context', { p_work_item_id: id(5), p_command: 'resolve_exception' });
  });
  it('passes the unchanged target and disposition only after same-ID lookup', async () => {
    rpc.mockResolvedValueOnce(failure).mockResolvedValueOnce(ok(frozen));
    expect((await prepareHuman(resolution)).data).toEqual(frozen);
    expect(rpc.mock.calls[1]).toEqual(['prepare_care_human_request', expect.objectContaining({ p_command: 'resolve_exception', p_payload: resolution.payload })]);
  });
  it.each(actions)('refuses changed actor before resolution RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(999) }, supabase: { rpc } });
    expect((await action(resolution)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['exception_id', 'reason', 'recorded_at', 'origin_revision'])('never replaces frozen target %s', async (key) => {
    const changed = { ...exception, [key]: key === 'exception_id' ? id(99) : key === 'origin_revision' ? '3' : key === 'recorded_at' ? due : 'Changed reason' };
    rpc.mockResolvedValue(ok({ ...frozen, payload: { ...frozen.payload, details: { exception: changed, disposition: 'clinical_non_delivery', resolution_reason: 'Professional non-delivery decision' } } }));
    expect((await applyHuman(resolution)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('recovers an expired applied resolution with inaccessible current context', async () => {
    const old = { ...resolution, payload: { ...resolution.payload, next_review_at: '2020-01-01T00:00:00Z' } };
    rpc.mockResolvedValue(ok({ ...done, payload: old.payload }));
    expect((await prepareHuman(old)).data?.state).toBe('applied');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_human_request', { p_request_id: resolution.request_id });
  });
  it('requires exact resolution proof, exposes lost cancellation as applied and acknowledges separately', async () => {
    rpc.mockResolvedValue(ok(done)); expect((await cancelHuman(resolution)).data?.receipt).toEqual(done.receipt);
    expect((await acknowledgeHuman(resolution)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...done, acknowledged_at: at })); expect((await acknowledgeHuman(resolution)).data?.acknowledged_at).toBe(at);
    rpc.mockResolvedValue(ok({ ...done, receipt: { ...done.receipt, resolved_exception_id: id(99) } })); expect((await recoverHuman(resolution)).data).toBeNull();
  });
  it('includes the third variant in exact private recovery pages', async () => {
    rpc.mockResolvedValue(ok({ items: [frozen], next_cursor: null }));
    expect((await loadPendingHuman({ ...scope, after: null })).data?.items[0].command).toBe('resolve_exception');
  });
});
