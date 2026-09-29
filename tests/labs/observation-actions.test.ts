import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { acknowledgeObservation, applyObservation, cancelObservation, loadPendingObservations, loadSourceContext, prepareObservation, recoverObservation } from '@/lib/labs/observation-actions';
import { observationInputSchema, observationStateSchema } from '@/lib/labs/observation-types';

const id = (n: number) => `66000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actor_id: id(1), organization_id: id(90), patient_id: id(11) }; const at = '2026-09-01T12:00:00.123456-04:00';
const input = observationInputSchema.parse({ ...scope, request_id: id(1100), root_id: id(2100), original_lab_result_id: id(100),
  analyte: 'potassium', command: 'correct_source', expected_revision: '1',
  payload: { evidence: '  Synthetic source  ', occurred_at: at, reason: '  Correction  ', value: '4.20', collected_at: at } });
const head = { version_id: id(3100), revision: '1', status: 'original', effective_lab_result_id: id(100), value: '4.6', collected_at: at };
const prepared = observationStateSchema.parse({ ...input, source_snapshot: head, state: 'prepared', recorded_at: at, acknowledged_at: null, receipt: null });
const receipt = { request_id: input.request_id, root_id: input.root_id, version_id: id(3101), revision: '2', previous_version_id: id(3100), original_lab_result_id: id(100),
  analyte: 'potassium', status: 'corrected', effective_lab_result_id: id(4000), stored_source: { value: '4.2', collected_at: at }, evaluation_status: 'pending', recorded_at: at,
  source_change_recorded: true, work_invalidation_recorded: false, order_authorship_confirmed: false, clinical_review_recorded: false, care_completed: false };
const applied = observationStateSchema.parse({ ...prepared, state: 'applied', receipt });
const context = { ...scope, can_mutate: true, snapshot: 'a'.repeat(64), next_cursor: null, items: [{ source_authority_organization_id: scope.organization_id,
  observation: { id: `${id(100)}:potassium`, patient_id: scope.patient_id, original_lab_result_id: id(100), analyte: 'potassium', root_id: id(2100),
    version_id: id(3100), revision: '1', status: 'original', effective_lab_result_id: id(100), value: '4.6', collected_at: at, notes: null, lab_facility: null, evaluation_status: null } }] };
const reply = (data: unknown) => rpc.mockResolvedValueOnce({ data, error: null });
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: scope.actor_id }, supabase: { rpc } }); });
describe('source command actions', () => {
  it.each([prepareObservation, recoverObservation, applyObservation, cancelObservation, acknowledgeObservation])('refuses changed actor and invalid schema before any RPC %#', async (action) => {
    expect((await action({ ...input, actor_id: id(2) })).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
    expect((await action({ ...input, request_id: 'bad' })).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it('recovers an exact historical preparation before reading sources or asking for clinical authority', async () => {
    reply(applied); expect((await prepareObservation(input)).data).toEqual(applied);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_lab_observation_request', { p_request_id: input.request_id });
  });
  it.each(['original_lab_result_id', 'analyte', 'root_id', 'payload', 'patient_id'])('rejects frozen identity tampering in %s with no fallback', async (key) => {
    reply(prepared);
    const change = key === 'analyte' ? 'sodium' : key === 'payload' ? { ...input.payload, evidence: 'Different source' } : id(999);
    expect((await prepareObservation({ ...input, [key]: change })).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { ...prepared, receipt }])('never interprets a successful malformed lookup as absence %#', async (data) => {
    reply(data); expect((await prepareObservation(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('after lookup error checks immutable root identity, then resends the exact request without head/capability gating', async () => {
    rpc.mockResolvedValueOnce({ error: { code: '42501' }, data: null });
    reply({ ...context, can_mutate: false, items: [{ ...context.items[0], observation: { ...context.items[0].observation,
      revision: '3', status: 'cancelled', value: null, effective_lab_result_id: null, version_id: id(3102) } }] }); reply(applied);
    expect((await prepareObservation(input)).data).toEqual(applied);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_lab_observation_request', 'get_lab_source_context', 'prepare_lab_observation_change']);
    expect(rpc).toHaveBeenLastCalledWith('prepare_lab_observation_change', { p_request_id: input.request_id, p_root_id: input.root_id,
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_expected_revision: '1', p_command: 'correct_source', p_payload: input.payload });
  });
  it.each(['root', 'organization', 'original', 'analyte', 'unregistered'])('does not forward an unverified source %s after a failed lookup', async (kind) => {
    rpc.mockResolvedValueOnce({ error: { code: '42501' }, data: null });
    const row = structuredClone(context.items[0]);
    if (kind === 'root') row.observation.root_id = id(999);
    if (kind === 'organization') row.source_authority_organization_id = id(91);
    if (kind === 'original') { row.observation.id = `${id(101)}:potassium`; row.observation.original_lab_result_id = id(101); row.observation.effective_lab_result_id = id(101); }
    if (kind === 'analyte') { row.observation.analyte = 'sodium'; row.observation.id = `${id(100)}:sodium`; }
    if (kind === 'unregistered') { reply({ ...context, items: [{ ...row, source_authority_organization_id: null, observation: { ...row.observation, root_id: null, version_id: null, revision: null } }] }); }
    else reply({ ...context, items: [row] });
    expect((await prepareObservation(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('sends a new registration with exact original/analyte and a frozen root ID', async () => {
    const register = observationInputSchema.parse({ ...input, command: 'register_source', expected_revision: '0', payload: { evidence: 'Source', occurred_at: at } });
    const saved = observationStateSchema.parse({ ...register, state: 'prepared', source_snapshot: { value: '4.6', collected_at: at }, recorded_at: at, acknowledged_at: null, receipt: null });
    rpc.mockResolvedValueOnce({ error: {}, data: null });
    reply({ ...context, items: [{ ...context.items[0], source_authority_organization_id: null, observation: { ...context.items[0].observation, root_id: null, version_id: null, revision: null } }] }); reply(saved);
    expect((await prepareObservation(register)).data).toEqual(saved);
    expect(rpc).toHaveBeenLastCalledWith('prepare_lab_observation', { p_request_id: register.request_id, p_root_id: register.root_id,
      p_organization_id: register.organization_id, p_patient_id: register.patient_id, p_original_lab_result_id: register.original_lab_result_id, p_analyte: register.analyte, p_payload: register.payload });
  });
  it.each([applyObservation, cancelObservation, acknowledgeObservation])('requires an exact successful pre-read before a non-prepare mutation %#', async (action) => {
    rpc.mockResolvedValueOnce({ error: {}, data: null }); expect((await action(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('does not auto-apply, retry, acknowledge, or evaluate after a lost response', async () => {
    reply(prepared); rpc.mockRejectedValueOnce(new Error('Lost apply reply'));
    expect((await applyObservation(input)).data).toBeNull(); expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_lab_observation_request', 'apply_lab_observation']);
    reply(applied); expect((await recoverObservation(input)).data).toEqual(applied);
  });
  it('accepts a late cancellation returning the already applied receipt without claiming undo', async () => {
    reply(prepared); reply(applied); expect((await cancelObservation(input)).data).toEqual(applied);
  });
  it.each([[applyObservation, prepared], [cancelObservation, prepared], [acknowledgeObservation, applied]] as const)('enforces operation postconditions %#', async (action, state) => {
    reply(prepared); reply(state); expect((await action(input)).data).toBeNull();
  });
  it('acknowledges an applied receipt with exact frozen history', async () => {
    reply(applied); reply({ ...applied, acknowledged_at: at });
    expect((await acknowledgeObservation(input)).data?.acknowledged_at).toBe(at);
  });
  it('loads explicit read context and monitor-only pending state independently', async () => {
    reply(context); expect((await loadSourceContext(scope)).data?.items).toEqual(context.items);
    reply({ items: [prepared], next_cursor: null }); expect((await loadPendingObservations({ ...scope, after: null })).data?.items).toEqual([prepared]);
  });
  it.each([{ actor_id: id(2) }, { patient_id: id(12) }, { organization_id: id(91) }])('refuses pending rows from a mismatched scope %#', async (change) => {
    reply({ items: [{ ...prepared, ...change }], next_cursor: null }); expect((await loadPendingObservations({ ...scope, after: null })).data).toBeNull();
  });
  it('refuses a repeated pending key and invalid cursor before sending', async () => {
    reply({ items: [prepared], next_cursor: null }); expect((await loadPendingObservations({ ...scope, after: prepared.request_id })).data).toBeNull();
    rpc.mockClear(); expect((await loadPendingObservations({ ...scope, after: 'bad' })).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
});
