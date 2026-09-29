import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { acknowledgePostclosure, applyPostclosure, cancelPostclosure, preparePostclosure, recoverPostclosure,
  loadPostclosureContext, loadPendingPostclosure, loadPostclosureNeeds, loadPostclosureHistory, loadPostclosureSuccessors } from '@/lib/care-workflow/postclosure-actions';
import { postclosureInputSchema } from '@/lib/care-workflow/postclosure-types';

const id = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number) => `2026-09-29T12:0${n}:00.123456Z`;
function fixture(replacement = false) {
  const scope = { actor_id: id(1), organization_id: id(2), patient_id: id(3) };
  const snapshot = { invalidation_id: id(4), organization_id: id(2), patient_id: id(3), predecessor_work_item_id: id(5),
    closure_event_id: id(6), closure_recorded_at: at(0), entry_id: id(7), composition_event_id: id(8),
    analyte: 'potassium', root_id: id(9), change_version_id: id(10), change_revision: '2', change_status: 'corrected',
    change_recorded_at: at(1), invalidation_recorded_at: at(1) };
  const input = { ...scope, request_id: id(11), invalidation_id: id(4), predecessor_work_item_id: id(5), work_item_id: id(12),
    expected_revision: '1', expected_ownership_revision: '1', expected_routing_revision: replacement ? '1' : '0', previous_event_id: replacement ? id(99) : null,
    payload: { snapshot, occurred_at: at(3), evidence: '  Frozen source evidence  ', reason: 'Explicit routing decision', review_at: at(9),
      responsibility_acknowledged: true, supersession_acknowledged: replacement } };
  const receipt = { request_id: id(11), event_id: id(13), invalidation_id: id(4), predecessor_work_item_id: id(5), work_item_id: id(12),
    previous_event_id: input.previous_event_id, routing_revision: replacement ? '2' : '1', workflow_revision: '1', ownership_revision: '1',
    recorded_at: at(5), review_at: at(9), delegated: true, clinical_invalidation_resolved: false,
    clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
  const state = { ...input, state: 'applied', recorded_at: at(4), acknowledged_at: null, receipt };
  const prepared = { ...input, state: 'prepared', recorded_at: at(4), acknowledged_at: null, receipt: null };
  const context = { ...scope, work_item_id: id(12), workflow_revision: '1', ownership_revision: '1', routing_revision: input.expected_routing_revision,
    previous_event_id: input.previous_event_id, previous_work_item_id: replacement ? id(98) : null,
    successor_created_at: at(2), successor_accepted_at: at(0), review_at: at(9), snapshot };
  const need = { invalidation_id: id(4), patient_id: id(3), predecessor_work_item_id: id(5), recorded_at: at(1), snapshot,
    current_route: null, routing_state: 'unrouted' };
  const needs = { organization_id: id(2), items: [need], next_cursor: null,
    counts: { unrouted: 1, delegated: 0, overdue: 0, responsibility_unavailable: 0, successor_closed: 0 } };
  const history = { invalidation_id: id(4), items: [{ event_id: id(13), actor_id: id(1), payload: input.payload, receipt }], next_cursor: null };
  const successors = { invalidation_id: id(4), items: [{ work_item_id: id(12), created_at: at(2), accepted_at: at(0),
    ownership_revision: '1', workflow_revision: '1', review_at: at(9) }], next_cursor: null };
  return { scope, input, receipt, state, prepared, context, snapshot, need, needs, history, successors };
}

const f = fixture(), input = postclosureInputSchema.parse(f.input);
const ok = (data: unknown) => ({ data, error: null }), failed = { data: null, error: { code: '42501', message: 'private diagnostic' } };
const actions = [preparePostclosure, recoverPostclosure, applyPostclosure, cancelPostclosure, acknowledgePostclosure];
const target = { ...f.scope, invalidation_id: id(4), after: null };
const read = { ...f.scope, invalidation_id: id(4), work_item_id: id(12) };
const need = (n: number, patient = id(3)) => ({ ...f.need, invalidation_id: id(n), patient_id: patient,
  snapshot: { ...f.snapshot, invalidation_id: id(n), patient_id: patient } });
const page = (start: number, patient = id(3), more = true) => ({ ...f.needs,
  items: Array.from({ length: 25 }, (_, n) => need(start + n, patient)), next_cursor: more ? id(start + 24) : null });
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(1) }, supabase: { rpc } }); rpc.mockResolvedValue(ok(f.prepared)); });
describe('recoverable routing actions', () => {
  it.each(actions)('rejects actor mismatch before RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(66) }, supabase: { rpc } });
    expect((await action(input)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(actions)('rejects malformed or substituted input before auth %#', async (action) => {
    expect((await action({ ...input, invalidation_id: id(66) })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it.each(actions)('sanitizes thrown authorization and transport errors %#', async (action) => {
    authorize.mockRejectedValueOnce(new Error('private diagnostic')); expect(JSON.stringify(await action(input))).not.toContain('private diagnostic');
    rpc.mockRejectedValueOnce(new Error('private diagnostic')); expect(JSON.stringify(await action(input))).not.toContain('private diagnostic');
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'invalidation_id', 'predecessor_work_item_id', 'request_id',
    'expected_routing_revision', 'expected_revision', 'expected_ownership_revision', 'previous_event_id'])('rejects substituted saved %s before apply or prepare retry', async (key) => {
    rpc.mockResolvedValue(ok({ ...f.prepared, [key]: key.endsWith('revision') ? '9' : id(66) }));
    expect((await applyPostclosure(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear(); expect((await preparePostclosure(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('preserves exact frozen evidence and refuses mutation after changed payload', async () => {
    rpc.mockResolvedValue(ok({ ...f.prepared, payload: { ...f.prepared.payload, evidence: f.input.payload.evidence.trim() } }));
    expect((await cancelPostclosure(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('submits the same ID with exact SQL arguments after an unsuccessful lookup', async () => {
    rpc.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok(f.prepared));
    expect((await preparePostclosure(input)).data).toEqual(f.prepared);
    expect(rpc).toHaveBeenNthCalledWith(2, 'prepare_care_postclosure_request', {
      p_request_id: id(11), p_invalidation_id: id(4), p_work_item_id: id(12), p_organization_id: id(2), p_patient_id: id(3),
      p_expected_revision: '1', p_expected_ownership_revision: '1', p_expected_routing_revision: '0',
      p_previous_event_id: null, p_payload: input.payload,
    });
  });
  it.each(['prepared', 'applied', 'cancelled'])('historical prepare replay %s never reads current scope/owner/need', async (state) => {
    const data = { ...(state === 'applied' ? f.state : f.prepared), state };
    rpc.mockResolvedValue(ok(data)); expect((await preparePostclosure(input)).data).toEqual(data);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_postclosure_request', { p_request_id: id(11) });
  });
  it.each([applyPostclosure, cancelPostclosure, acknowledgePostclosure])('cannot mutate after ambiguous recovery %#', async (action) => {
    rpc.mockResolvedValue(failed); expect((await action(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('requires honest terminal outcomes and exact ACK, even if cancellation loses to apply', async () => {
    expect((await applyPostclosure(input)).data).toBeNull(); expect((await cancelPostclosure(input)).data).toBeNull();
    rpc.mockResolvedValue(ok(f.state));
    expect((await cancelPostclosure(input)).data?.state).toBe('applied'); expect((await applyPostclosure(input)).data?.receipt?.delegated).toBe(true);
    expect((await acknowledgePostclosure(input)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...f.state, acknowledged_at: at(6) })); expect((await acknowledgePostclosure(input)).data?.acknowledged_at).toBe(at(6));
  });
  it('recovers superseded old receipt without any current target/context lookup', async () => {
    const g = fixture(true), old = postclosureInputSchema.parse(g.input);
    rpc.mockResolvedValue(ok(g.state)); expect((await recoverPostclosure(old)).data).toEqual(g.state);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_postclosure_request', { p_request_id: id(11) });
  });
});
describe('minimal authorized routing readers', () => {
  it('exact fresh context uses the dedicated RPC', async () => {
    rpc.mockResolvedValue(ok(f.context)); expect((await loadPostclosureContext(read)).data).toEqual(f.context);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_postclosure_context', { p_invalidation_id: id(4), p_work_item_id: id(12) });
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id'])('rejects changed context %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...f.context, [key]: id(66) })); expect((await loadPostclosureContext(read)).data).toBeNull();
  });
  it('private pending recovery has no minimal-need preflight and checks the whole scope', async () => {
    rpc.mockResolvedValue(ok({ items: [f.prepared], next_cursor: null }));
    expect((await loadPendingPostclosure({ ...f.scope, after: id(10) })).data?.items).toHaveLength(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('list_pending_care_postclosure_requests', { p_organization_id: id(2), p_patient_id: id(3), p_after: id(10) });
    expect((await loadPendingPostclosure({ ...f.scope, after: id(11) })).data).toBeNull();
    rpc.mockResolvedValue(ok({ items: [{ ...f.prepared, actor_id: id(77) }], next_cursor: null }));
    expect((await loadPendingPostclosure({ ...f.scope, after: null })).data).toBeNull();
  });
  it('validates raw pages then filters before return, preserving empty-page cursor and explicitly organization counts', async () => {
    rpc.mockResolvedValue(ok(page(100, id(77))));
    const result = await loadPostclosureNeeds({ ...f.scope, after: null });
    expect(result.data).toEqual({ organization_id: id(2), patient_id: id(3), items: [], next_cursor: id(124), organization_counts: f.needs.counts });
    expect(JSON.stringify(result)).not.toContain(id(77));
    rpc.mockResolvedValue(ok({ ...page(125, id(77)), items: [need(125), ...page(126, id(77)).items.slice(0, 24)], next_cursor: id(149) }));
    const partial = await loadPostclosureNeeds({ ...f.scope, after: id(124) });
    expect(partial.data?.items).toHaveLength(1); expect(partial.data?.next_cursor).toBe(id(149));
  });
  it.each(['unordered', 'duplicate', 'short-cursor', 'foreign-org'])('rejects malformed raw pages before filtering: %s', async (kind) => {
    const data = page(100, id(77));
    if (kind === 'unordered') data.items.reverse();
    if (kind === 'duplicate') data.items[1] = data.items[0];
    if (kind === 'short-cursor') data.items = [];
    if (kind === 'foreign-org') data.organization_id = id(66);
    rpc.mockResolvedValue(ok(data)); expect((await loadPostclosureNeeds({ ...f.scope, after: null })).data).toBeNull();
  });
  it('searches beyond an other-patient page, then reads exact target without predecessor-private RPC', async () => {
    const targetNeed = need(130), history = { ...f.history, invalidation_id: id(130),
      items: [{ ...f.history.items[0], payload: { ...f.input.payload, snapshot: targetNeed.snapshot }, receipt: { ...f.receipt, invalidation_id: id(130) } }] };
    rpc.mockResolvedValueOnce(ok(page(100, id(77)))).mockResolvedValueOnce(ok({ ...f.needs, items: [targetNeed] })).mockResolvedValueOnce(ok(history));
    expect((await loadPostclosureHistory({ ...target, invalidation_id: id(130) })).data).toEqual(history);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['list_care_postclosure_needs', 'list_care_postclosure_needs', 'list_care_postclosure_history']);
    expect(rpc).toHaveBeenNthCalledWith(2, 'list_care_postclosure_needs', { p_organization_id: id(2), p_after: id(124) });
  });
  it.each(['empty', 'failed', 'repeated'])('cannot infer missing target after %s tail', async (tail) => {
    rpc.mockResolvedValueOnce(ok(page(100, id(77)))).mockResolvedValueOnce(tail === 'failed' ? failed
      : ok(tail === 'empty' ? { ...f.needs, items: [] } : page(100, id(77))));
    const result = await loadPostclosureHistory({ ...target, invalidation_id: id(999) });
    expect(result.data).toBeNull(); expect(result.error).toContain('No conclusion'); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('bounds target lookup at 128 pages and fails explicitly without calling private readers', async () => {
    let n = 0; rpc.mockImplementation(async () => ok(page(100 + 25 * n++, id(77))));
    const result = await loadPostclosureHistory({ ...target, invalidation_id: id(999999) });
    expect(result.data).toBeNull(); expect(result.error).toContain('No conclusion'); expect(rpc).toHaveBeenCalledTimes(128);
    expect(rpc.mock.calls.every(([name]) => name === 'list_care_postclosure_needs')).toBe(true);
  });
  it('does not use manager counts or another patient target as permission for detail', async () => {
    rpc.mockResolvedValue(ok({ ...f.needs, items: [need(4, id(77))] }));
    expect((await loadPostclosureHistory(target)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear(); rpc.mockResolvedValue(ok({ ...f.needs, items: [] }));
    expect((await loadPostclosureSuccessors(target)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('validates history starting revision independently of a concurrently replaced live route', async () => {
    rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok(f.history));
    expect((await loadPostclosureHistory(target)).data).toEqual(f.history);
    rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok(f.history));
    expect((await loadPostclosureHistory({ ...target, after: '1' })).data).toBeNull();
    const changed = { ...f.history, items: [{ ...f.history.items[0], payload: { ...f.input.payload, snapshot: { ...f.snapshot, root_id: id(66) } } }] };
    rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok(changed));
    expect((await loadPostclosureHistory(target)).data).toBeNull();
  });
  it('successor results must be exact target, subsequent server creation, distinct predecessor and ordered cursor', async () => {
    rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok(f.successors));
    expect((await loadPostclosureSuccessors(target)).data).toEqual(f.successors);
    for (const change of [{ created_at: at(0) }, { work_item_id: id(5) }]) {
      rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok({ ...f.successors, items: [{ ...f.successors.items[0], ...change }] }));
      expect((await loadPostclosureSuccessors(target)).data).toBeNull();
    }
    rpc.mockResolvedValueOnce(ok(f.needs)).mockResolvedValueOnce(ok(f.successors));
    expect((await loadPostclosureSuccessors({ ...target, after: id(12) })).data).toBeNull();
  });
  it('malformed readers and changed actors never reach RPC', async () => {
    expect((await loadPostclosureHistory({ ...target, after: 'NaN' })).data).toBeNull();
    expect((await loadPostclosureNeeds({ ...f.scope, after: 'bad' })).data).toBeNull();
    expect((await loadPostclosureContext({ ...read, work_item_id: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
    authorize.mockResolvedValue({ authorized: true, user: { id: id(66) }, supabase: { rpc } });
    expect((await loadPostclosureHistory(target)).data).toBeNull(); expect((await loadPostclosureSuccessors(target)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
});
