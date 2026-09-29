import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { prepareComposition, recoverComposition, applyComposition, cancelComposition, acknowledgeComposition,
  loadCompositionDetail, loadPendingCompositions, loadCompositionIntentions, loadCompositionInvalidations } from '@/lib/care-workflow/composition-actions';
import { compositionInputSchema } from '@/lib/care-workflow/composition-types';
const id = (n: number) => `68000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-01T12:00:00.123456-04:00';
const payload = { occurred_at: at, next_review_at: '2026-10-01T12:00:00.123456-04:00', evidence: '  Synthetic evidence  ',
  reason: '  Exact source mapping  ', next_action: 'Review missing evidence', sources: [
    { analyte: 'egfr', root_id: null, expected_root_revision: null },
    { analyte: 'potassium', root_id: id(400), expected_root_revision: '1' },
  ], intent_resolutions: [] };
const input = { actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), request_id: id(200),
  expected_revision: '1', expected_ownership_revision: '1', payload };
const prepared = { ...input, state: 'prepared', recorded_at: at, acknowledged_at: null, receipt: null };
const head = { version_id: id(500), revision: '1', status: 'original', effective_lab_result_id: id(600), value: '4.600', collected_at: at };
const receipt = { request_id: id(200), work_item_id: id(100), event_id: id(300), previous_event_id: null, workflow_revision: '2',
  ownership_revision: '1', stage: 'result_received', recorded_at: at, due_at: at,
  sources: [{ analyte: 'egfr', root_id: null, observed_head: null }, { analyte: 'potassium', root_id: id(400), observed_head: head }],
  intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
const applied = { ...prepared, state: 'applied', receipt };
const detail = { actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), workflow_revision: '2', ownership_revision: '1',
  stage: 'result_received', composition_event_id: id(300), pending_intent_count: '0', invalidation_count: '0',
  clinical_review_recorded: false, communication_confirmed: false, care_completed: false,
  sources: [{ analyte: 'egfr', entry_id: id(700), root_id: null, authority_organization_id: null, original_lab_result_id: null,
    observed_version_id: null, head: null, evaluation_status: null, quality: 'missing' },
  { analyte: 'potassium', entry_id: id(701), root_id: id(400), authority_organization_id: id(90), original_lab_result_id: id(600),
    observed_version_id: id(500), head, evaluation_status: 'pending', quality: 'available' }] };

const frozen = compositionInputSchema.parse(input);
const scope = { actor_id: input.actor_id, organization_id: input.organization_id, patient_id: input.patient_id };
const work = { ...scope, work_item_id: input.work_item_id };
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: input.actor_id }, supabase: { rpc } }); rpc.mockResolvedValue(ok(prepared)); });
describe('recoverable composition server actions', () => {
  const actions = [prepareComposition, recoverComposition, applyComposition, cancelComposition, acknowledgeComposition];
  it.each(actions)('rejects a different current actor before RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(999) }, supabase: { rpc } });
    expect((await action(frozen)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(actions)('validates frozen input before authorization %#', async (action) => {
    expect((await action({ ...frozen, request_id: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it('replays a terminal exact preparation before reading current heads or ownership', async () => {
    rpc.mockResolvedValue(ok(applied)); expect((await prepareComposition(frozen)).data).toEqual(applied);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_lab_composition_request', { p_request_id: input.request_id });
  });
  it('lets same-ID SQL distinguish a fresh request from a failed read, never inventing absence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } }).mockResolvedValueOnce(ok(prepared));
    expect((await prepareComposition(frozen)).data).toEqual(prepared);
    expect(rpc).toHaveBeenNthCalledWith(2, 'prepare_care_lab_composition', { p_request_id: input.request_id, p_work_item_id: input.work_item_id,
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_expected_revision: input.expected_revision,
      p_expected_ownership_revision: input.expected_ownership_revision, p_payload: input.payload });
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'request_id', 'expected_revision', 'expected_ownership_revision'])('does not mutate a mismatched %s', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: key.includes('revision') ? '9' : id(999) }));
    expect((await applyComposition(frozen)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('retains the exact frozen reason without trimming or substituting it', async () => {
    rpc.mockResolvedValue(ok({ ...prepared, payload: { ...payload, reason: payload.reason.trim() } }));
    expect((await cancelComposition(frozen)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('applies only after matching recovery; a cancelled prepare is not successful application', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(applied));
    expect((await applyComposition(frozen)).data).toEqual(applied);
    rpc.mockResolvedValue(ok({ ...prepared, state: 'cancelled' })); expect((await applyComposition(frozen)).data).toBeNull();
  });
  it('returns the saved outcome when cancel loses, without asserting cancellation', async () => {
    rpc.mockResolvedValue(ok(applied)); expect((await cancelComposition(frozen)).data?.state).toBe('applied');
    rpc.mockResolvedValue(ok(prepared)); expect((await cancelComposition(frozen)).data).toBeNull();
  });
  it('requires an applied acknowledged receipt for ACK success', async () => {
    rpc.mockResolvedValue(ok(applied)); expect((await acknowledgeComposition(frozen)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...applied, acknowledged_at: at })); expect((await acknowledgeComposition(frozen)).data?.acknowledged_at).toBe(at);
  });
  it.each(['reject', '42501', '40001'])('contains %s without retry or diagnostic leakage', async (code) => {
    if (code === 'reject') rpc.mockRejectedValue(new Error('private'));
    else rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } });
    const result = await applyComposition(frozen); expect(result.data).toBeNull(); expect(JSON.stringify(result)).not.toContain('private');
    expect(rpc).toHaveBeenCalledOnce();
  });
  it('checks current detail identity without conflating it with historical receipts', async () => {
    rpc.mockResolvedValue(ok(detail)); expect((await loadCompositionDetail(work)).data).toEqual(detail);
    for (const key of ['actor_id', 'organization_id', 'patient_id', 'work_item_id']) {
      rpc.mockResolvedValue(ok({ ...detail, [key]: id(999) })); expect((await loadCompositionDetail(work)).data).toBeNull();
    }
  });
  it('preserves complete pending25+tail and rejects changed scope, backwards IDs and failed pages', async () => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...prepared, request_id: id(1000 + n) }));
    rpc.mockResolvedValue(ok({ items, next_cursor: id(1024) }));
    expect((await loadPendingCompositions({ ...scope, after: null })).data?.items).toHaveLength(25);
    rpc.mockResolvedValue(ok({ items: [{ ...prepared, request_id: id(1025) }], next_cursor: null }));
    expect((await loadPendingCompositions({ ...scope, after: id(1024) })).data?.items).toHaveLength(1);
    expect((await loadPendingCompositions({ ...scope, after: id(1025) })).data).toBeNull();
    rpc.mockResolvedValue(ok({ items: [{ ...prepared, actor_id: id(999) }], next_cursor: null }));
    expect((await loadPendingCompositions({ ...scope, after: null })).data).toBeNull();
  });
  it.each([loadCompositionIntentions, loadCompositionInvalidations])('checks work organization and patient before shared read %#', async (read) => {
    rpc.mockResolvedValue(ok({ ...work, organization_id: id(999) }));
    expect((await read({ ...work, after: null })).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockReset(); rpc.mockResolvedValueOnce(ok(work)).mockResolvedValueOnce(ok({ work_item_id: input.work_item_id, items: [], next_cursor: null }));
    expect((await read({ ...work, after: null })).data?.items).toEqual([]);
    expect(authorize).toHaveBeenCalledWith('provider');
  });
  it('requires explicit null or exact recorded resolution on every invalidation', async () => {
    const row = { id: id(800), entry_id: id(700), change_version_id: id(501), recorded_at: at, analyte: 'potassium', root_id: id(400), event_id: id(300), resolution: null };
    const resolution = { event_id: id(801), revision: '5', recorded_at: at, disposition: 'no_longer_used' };
    for (const value of [null, resolution]) {
      const page = { work_item_id: input.work_item_id, items: [{ ...row, resolution: value }], next_cursor: null };
      rpc.mockResolvedValueOnce(ok(work)).mockResolvedValueOnce(ok(page)); expect((await loadCompositionInvalidations({ ...work, after: null })).data).toEqual(page);
    }
    for (const value of [undefined, { ...resolution, care_completed: true }, { ...resolution, revision: 'bad' }]) {
      rpc.mockResolvedValueOnce(ok(work)).mockResolvedValueOnce(ok({ work_item_id: input.work_item_id, items: [{ ...row, resolution: value }], next_cursor: null }));
      expect((await loadCompositionInvalidations({ ...work, after: null })).data).toBeNull();
    }
  });
});
