import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc, revalidatePath } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('next/cache', () => ({ revalidatePath }));
import { acknowledgeCareStep, applyCareStep, cancelCareStep, loadCareWorkflow, loadPendingCareSteps,
  prepareCareStep, recoverCareStep } from '@/lib/care-workflow/step-actions';
import { CARE_STEP_UNCONFIRMED, careWorkflowDetailSchema, validateNewCareStep, type CareStepInput, type CareStepState } from '@/lib/care-workflow/step-types';
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { actor_id: id(1), patient_id: id(2), organization_id: id(3) };
const input: CareStepInput = { ...scope, request_id: id(4), work_item_id: id(5), expected_revision: '1', expected_ownership_revision: '9007199254740993',
  command: 'record_collection', payload: { occurred_at: '2026-09-29T12:00:00Z', evidence: '  Synthetic evidence  ', next_action: 'Review next step',
    next_review_at: '2026-10-01T12:00:00Z', details: {} } };
const prepared: CareStepState = { ...input, state: 'prepared', recorded_at: '2026-09-29T13:00:00.123456+00:00', acknowledged_at: null, receipt: null };
const applied: CareStepState = { ...prepared, state: 'applied', receipt: { request_id: input.request_id, work_item_id: input.work_item_id,
  event_id: id(6), workflow_revision: '2', ownership_revision: input.expected_ownership_revision, stage: 'collected', exception_id: null,
  due_at: input.payload.next_review_at, recorded_at: prepared.recorded_at,
  clinical_review_recorded: false, communication_confirmed: false, care_completed: false } };
const detail = { work_item_id: input.work_item_id, patient_id: scope.patient_id, organization_id: scope.organization_id,
  assigned_to: scope.actor_id, accepted_by: scope.actor_id, accepted_at: prepared.recorded_at, transfer_pending_to: null,
  ownership_revision: input.expected_ownership_revision, due_at: input.payload.next_review_at, kind: 'laboratory_order', stage: 'requested', revision: '1',
  requested_analytes: ['potassium'], request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'P'.repeat(1000), evidence: 'Original request',
    occurred_at: input.payload.occurred_at, next_review_at: input.payload.next_review_at, analytes: ['potassium'] },
  events: [{ id: id(9), actor_id: scope.actor_id, revision: '1', event_type: 'request_recorded', occurred_at: input.payload.occurred_at, recorded_at: prepared.recorded_at }],
  next_action: 'P'.repeat(1000), next_review_at: input.payload.next_review_at, work_status: 'new', steps: [], compositions: [], humans: [], exceptions: [] };
const read = { actor_id: scope.actor_id, patient_id: scope.patient_id, work_item_id: input.work_item_id };
const ok = (data: unknown) => ({ data, error: null });
const operations = [prepareCareStep, recoverCareStep, applyCareStep, cancelCareStep, acknowledgeCareStep];
beforeEach(() => {
  vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: scope.actor_id }, supabase: { rpc } });
  rpc.mockImplementation(async (name) => ok(name === 'get_care_workflow_steps' ? detail : prepared));
});
describe('care step actions', () => {
  it('checks workflow scope before preparing the exact frozen command with bigint strings', async () => {
    expect(await prepareCareStep(input)).toEqual(ok(prepared));
    expect(authorize).toHaveBeenCalledWith('provider');
    expect(rpc.mock.calls).toEqual([['get_care_workflow_steps', { p_work_item_id: input.work_item_id }], ['prepare_care_step', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_expected_revision: '1',
      p_expected_ownership_revision: '9007199254740993', p_command: input.command, p_payload: input.payload,
    }]]); expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each(['patient_id', 'organization_id', 'work_item_id'])('denies cross-%s preparation before any write', async (key) => {
    rpc.mockResolvedValue(ok({ ...detail, [key]: id(99) }));
    expect((await prepareCareStep(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([false, 'changed'])('fails before any RPC on authorization/session %s', async (mode) => {
    authorize.mockResolvedValue(mode === false ? { authorized: false } : { authorized: true, user: { id: id(99) }, supabase: { rpc } });
    for (const action of operations) expect((await action(input)).data).toBeNull();
    expect((await loadCareWorkflow(read)).data).toBeNull(); expect((await loadPendingCareSteps({ ...scope, after: null })).data).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'request_id', 'expected_revision', 'expected_ownership_revision'])('rejects changed %s before apply', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: key.includes('revision') ? '9' : id(99) }));
    expect((await applyCareStep(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_step_request', { p_request_id: input.request_id });
  });
  it.each(['evidence', 'next_action', 'occurred_at', 'next_review_at'])('does not normalize frozen payload %s', async (key) => {
    const changed = key.includes('_at') ? '2026-09-29T12:00:01Z' : 'Changed text';
    rpc.mockResolvedValue(ok({ ...prepared, payload: { ...input.payload, [key]: changed } }));
    expect((await cancelCareStep(input)).data).toBeNull(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('matches nested details independently of JSON property order', async () => {
    const command = { command: 'record_schedule' as const, payload: { ...input.payload,
      details: { appointment_date: '2026-10-01', appointment_at: null, appointment_timezone: null } } };
    rpc.mockResolvedValue(ok({ ...prepared, ...command, payload: { ...command.payload,
      details: { appointment_timezone: null, appointment_at: null, appointment_date: '2026-10-01' } } }));
    expect((await recoverCareStep({ ...input, ...command })).data?.state).toBe('prepared');
  });
  it('applies only after matching recovery and keeps the current page mounted', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(applied));
    expect(await applyCareStep(input)).toEqual(ok(applied));
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_care_step_request', 'apply_care_step']);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('recovers an old owner receipt without demanding current workflow visibility', async () => {
    rpc.mockResolvedValue(ok(applied));
    expect(await recoverCareStep(input)).toEqual(ok(applied));
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_care_step_request', { p_request_id: input.request_id });
  });
  it('preserves an applied receipt if cancellation loses the race', async () => {
    rpc.mockResolvedValue(ok(applied)); expect(await cancelCareStep(input)).toEqual(ok(applied));
  });
  it('allows confirmed cancellation and explicit ACK only', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok({ ...prepared, state: 'cancelled' }));
    expect((await cancelCareStep(input)).data?.state).toBe('cancelled');
    rpc.mockResolvedValue(ok(applied)); expect((await acknowledgeCareStep(input)).data).toBeNull();
    rpc.mockResolvedValue(ok({ ...applied, acknowledged_at: prepared.recorded_at }));
    expect((await acknowledgeCareStep(input)).data?.acknowledged_at).toBe(prepared.recorded_at);
  });
  it.each([null, {}, { ...applied, receipt: null }, { ...applied, receipt: { ...applied.receipt, care_completed: true } }])('rejects malformed success %#', async (data) => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(data)); expect((await applyCareStep(input)).data).toBeNull();
  });
  it.each(['reject', '40001', '42501'])('contains %s without automatic retry, rebasing or diagnostic leakage', async (code) => {
    if (code === 'reject') rpc.mockRejectedValue(new Error('private diagnostic'));
    else rpc.mockResolvedValue({ data: null, error: { code, message: 'private diagnostic' } });
    expect(await applyCareStep(input)).toEqual({ data: null, error: CARE_STEP_UNCONFIRMED }); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('validates input before authorization', async () => {
    for (const action of operations) expect((await action({ ...input, request_id: 'bad' })).data).toBeNull();
    expect((await loadCareWorkflow({ ...read, patient_id: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
});
describe('workflow reads and pagination', () => {
  it('fails closed on absent mixed history without preventing private receipt recovery', async () => {
    rpc.mockImplementation(async (name) => ok(name === 'get_care_workflow_steps' ? { ...detail, compositions: undefined } : prepared));
    expect((await loadCareWorkflow(read)).data).toBeNull();
    expect((await prepareCareStep(input)).data).toBeNull();
    expect(rpc.mock.calls.some(([name]) => name === 'prepare_care_step')).toBe(false);
    expect((await recoverCareStep(input)).data).toEqual(prepared);
  });
  it('accepts initial 1000-character action and exact route scope', async () => {
    expect((await loadCareWorkflow(read)).data).toEqual(detail);
  });
  it.each([{ patient_id: id(99) }, { work_item_id: id(99) }, { revision: '2' }, { requested_analytes: ['creatinine'] },
    { events: [] }, { stage: 'obtained' }, { request: { ...detail.request, kind: 'referral', analytes: [] } }])('rejects inconsistent detail %#', async (change) => {
    rpc.mockResolvedValue(ok({ ...detail, ...change })); expect((await loadCareWorkflow(read)).data).toBeNull();
  });
  it('accepts denied assistance barriers but requires a real origin event', () => {
    const request = { ...detail.request, kind: 'medication_access', analytes: [] };
    const steps = [
      { id: id(80), actor_id: scope.actor_id, revision: '2', ownership_revision: '0', from_stage: 'requested', to_stage: 'assistance_requested',
        occurred_at: input.payload.occurred_at, recorded_at: prepared.recorded_at, command: 'record_assistance_request', payload: { ...input.payload, details: { assistance_program: 'Synthetic program', request_reference: 'Reference_1' } } },
      { id: id(81), actor_id: scope.actor_id, revision: '3', ownership_revision: '0', from_stage: 'assistance_requested', to_stage: 'response_received',
        occurred_at: input.payload.occurred_at, recorded_at: prepared.recorded_at, command: 'record_assistance_response', payload: { ...input.payload, details: { outcome: 'denied', response_reference: 'Reference_2' } } },
    ];
    const exceptions = [{ id: id(82), origin_event_id: id(81), human_origin_event_id: null, code: 'assistance_denied', reason: 'Documented denial', next_action: 'Review alternatives',
      next_review_at: input.payload.next_review_at, recorded_at: prepared.recorded_at }];
    const value = { ...detail, kind: 'medication_access', requested_analytes: [], request, revision: '3', stage: 'response_received', steps, exceptions };
    expect(careWorkflowDetailSchema.safeParse(value).success).toBe(true);
    expect(careWorkflowDetailSchema.safeParse({ ...value, exceptions: [{ ...exceptions[0], origin_event_id: id(99) }] }).success).toBe(false);
  });
  it('loads 25 records plus a tail, including other work receipts', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...prepared, request_id: id(10 + i), work_item_id: id(50) }));
    rpc.mockResolvedValueOnce(ok({ items, next_cursor: id(34) }));
    expect((await loadPendingCareSteps({ ...scope, after: null })).data?.items).toHaveLength(25);
    rpc.mockResolvedValue(ok({ items: [{ ...prepared, request_id: id(35) }], next_cursor: null }));
    expect((await loadPendingCareSteps({ ...scope, after: id(34) })).data?.items).toHaveLength(1);
  });
  it.each([null, {}, { items: [], next_cursor: id(1) }, { items: [prepared, prepared], next_cursor: null },
    { items: [{ ...prepared, actor_id: id(99) }], next_cursor: null }, { items: [{ ...prepared, organization_id: id(99) }], next_cursor: null },
    { items: [{ ...prepared, patient_id: id(99) }], next_cursor: null }, { items: [{ ...prepared, state: 'cancelled' }], next_cursor: null },
    { items: [{ ...applied, acknowledged_at: prepared.recorded_at }], next_cursor: null }, { items: [prepared], next_cursor: id(99) }])('fails closed on malformed page %#', async (data) => {
    rpc.mockResolvedValue(ok(data)); expect((await loadPendingCareSteps({ ...scope, after: null })).data).toBeNull();
  });
  it('requires advancing IDs and explicit empty success', async () => {
    rpc.mockResolvedValue(ok({ items: [prepared], next_cursor: null }));
    expect((await loadPendingCareSteps({ ...scope, after: input.request_id })).data).toBeNull();
    rpc.mockResolvedValue(ok({ items: [], next_cursor: null })); expect((await loadPendingCareSteps({ ...scope, after: null })).data?.items).toEqual([]);
  });
});
describe('fresh form validation without rewriting history', () => {
  const now = Date.parse('2026-09-29T13:00:00Z');
  const schedule = (at: string | null, zone: string | null, date = '2026-11-01') => ({ command: 'record_schedule',
    payload: { ...input.payload, details: { appointment_date: date, appointment_at: at, appointment_timezone: zone } } });
  it.each(['2026-11-01T01:30:00-04:00', '2026-11-01T01:30:00-05:00'])('preserves either explicit fall-back offset %s', (at) => {
    expect(validateNewCareStep(schedule(at, 'America/New_York'), now)).toEqual(schedule(at, 'America/New_York'));
  });
  it.each([['2026-11-01T01:30:00-06:00', 'America/New_York', '2026-11-01'],
    ['2026-03-08T02:30:00-05:00', 'America/New_York', '2026-03-08'], ['2026-11-01T01:30:00-04:00', 'America/New_York', '2026-11-02'],
    ['2026-11-01T01:30:00Z', 'Invalid/Zone', '2026-11-01'], ['2026-11-01T01:30:00Z', null, '2026-11-01']])('rejects incoherent appointment %#', (at, zone, date) => {
    expect(validateNewCareStep(schedule(at, zone, date!), now)).toBeNull();
  });
  it('allows civil date alone and does not use it as the review deadline', () => {
    expect(validateNewCareStep(schedule(null, null), now)?.payload.next_review_at).toBe(input.payload.next_review_at);
  });
  it('rejects whitespace-only text and checks microsecond occurrence/deadline boundaries', () => {
    expect(validateNewCareStep({ command: input.command, payload: { ...input.payload, evidence: '   ' } }, now)).toBeNull();
    expect(validateNewCareStep({ command: input.command, payload: { ...input.payload, occurred_at: '2026-09-29T13:00:00.000001Z' } }, now)).toBeNull();
    expect(validateNewCareStep({ command: input.command, payload: { ...input.payload, next_review_at: '2026-09-29T13:00:00Z' } }, now)).toBeNull();
  });
});
