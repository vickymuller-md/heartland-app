import { beforeEach, describe, expect, it, vi } from 'vitest';
const { authorize, rpc } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
import { prepareSubmissionIntent, recoverSubmissionIntent, cancelSubmissionIntent, loadPendingSubmissionIntents } from '@/lib/care-workflow/submission-intent-actions';
import { submissionIntentInputSchema } from '@/lib/care-workflow/submission-intent-types';
const id = (n: number) => `67000000-0000-4000-8000-${String(n).padStart(12, '0')}`; const at = '2026-09-01T12:00:00.123456-04:00';
const input = { intent_id: id(200), actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), submission_request_id: id(300),
  expected_revision: '1', expected_ownership_revision: '1', payload: { analytes: ['potassium', 'egfr'], evidence: '  Original source  ', occurred_at: at } };
const prepared = { ...input, state: 'prepared', recorded_at: at, cancelled_at: null, reconciled_at: null, reconciliation: null, result_linked: false, clinical_review_recorded: false, care_completed: false,
  submission: { status: 'awaiting_save', lab_result_id: null, event_id: null, evaluation_status: null, saved_at: null, acknowledged_at: null,
    recorded_analytes: [], missing_analytes: ['potassium', 'egfr'] } };
const saved = { ...prepared, submission: { status: 'saved_not_linked', lab_result_id: id(400), event_id: id(500), evaluation_status: 'pending', saved_at: at,
  acknowledged_at: null, recorded_analytes: ['creatinine', 'potassium'], missing_analytes: ['egfr'] } };

const frozen = submissionIntentInputSchema.parse(input);
const scope = { actor_id: input.actor_id, organization_id: input.organization_id, patient_id: input.patient_id };
const ok = (data: unknown) => ({ data, error: null });
beforeEach(() => { vi.resetAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: input.actor_id }, supabase: { rpc } }); rpc.mockResolvedValue(ok(prepared)); });
describe('recoverable pre-save intention actions', () => {
  const actions = [prepareSubmissionIntent, recoverSubmissionIntent, cancelSubmissionIntent];
  it.each(actions)('checks expected actor before any RPC %#', async (action) => {
    authorize.mockResolvedValue({ authorized: true, user: { id: id(999) }, supabase: { rpc } });
    expect((await action(frozen)).data).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(actions)('checks input before authorization %#', async (action) => {
    expect((await action({ ...frozen, intent_id: 'bad' })).data).toBeNull(); expect(authorize).not.toHaveBeenCalled();
  });
  it('prepares the same identity after a failed read without assuming absence', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } }).mockResolvedValueOnce(ok(prepared));
    expect((await prepareSubmissionIntent(frozen)).data).toEqual(prepared);
    expect(rpc).toHaveBeenNthCalledWith(2, 'prepare_lab_followup_intent', { p_intent_id: input.intent_id,
      p_work_item_id: input.work_item_id, p_organization_id: input.organization_id, p_patient_id: input.patient_id,
      p_submission_request_id: input.submission_request_id, p_expected_revision: input.expected_revision,
      p_expected_ownership_revision: input.expected_ownership_revision, p_payload: input.payload });
  });
  it('returns an exact historical preparation without needing current ownership', async () => {
    rpc.mockResolvedValue(ok(saved)); expect((await prepareSubmissionIntent(frozen)).data).toEqual(saved);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_lab_followup_intent', { p_intent_id: input.intent_id });
  });
  it.each(['intent_id', 'work_item_id', 'actor_id', 'organization_id', 'patient_id', 'submission_request_id',
    'expected_revision', 'expected_ownership_revision'])('refuses a changed %s before mutation', async (key) => {
    rpc.mockResolvedValue(ok({ ...prepared, [key]: key.includes('revision') ? '9' : id(999) }));
    expect((await cancelSubmissionIntent(frozen)).data).toBeNull(); expect(rpc).toHaveBeenCalledOnce();
  });
  it('does not rewrite frozen evidence or intended analytes', async () => {
    for (const payload of [{ ...input.payload, evidence: input.payload.evidence.trim() }, { ...input.payload, analytes: ['potassium'] }]) {
      rpc.mockResolvedValue(ok({ ...prepared, payload })); expect((await prepareSubmissionIntent(frozen)).data).toBeNull();
    }
    expect(rpc.mock.calls.every(([name]) => name === 'get_lab_followup_intent')).toBe(true);
  });
  it('shows winning save as saved_not_linked, not cancelled', async () => {
    rpc.mockResolvedValueOnce(ok(prepared)).mockResolvedValueOnce(ok(saved));
    expect((await cancelSubmissionIntent(frozen)).data).toEqual(saved);
  });
  it('requires cancelled or actually saved evidence after cancellation', async () => {
    expect((await cancelSubmissionIntent(frozen)).data).toBeNull();
    const cancelled = { ...prepared, state: 'cancelled', cancelled_at: at, submission: { ...prepared.submission, status: 'submission_cancelled' } };
    rpc.mockResolvedValue(ok(cancelled)); expect((await cancelSubmissionIntent(frozen)).data).toEqual(cancelled);
  });
  it('recovers an exact acknowledged save without evaluating or inserting again', async () => {
    rpc.mockResolvedValue(ok({ ...saved, submission: { ...saved.submission, acknowledged_at: at } }));
    expect((await recoverSubmissionIntent(frozen)).data?.submission.acknowledged_at).toBe(at);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_lab_followup_intent', { p_intent_id: input.intent_id });
  });
  it.each(['reject', '42501', '40001'])('contains %s without creating another identity', async (code) => {
    if (code === 'reject') rpc.mockRejectedValue(new Error('private'));
    else rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } });
    const response = await cancelSubmissionIntent(frozen);
    expect(response.data).toBeNull(); expect(JSON.stringify(response)).not.toContain('private'); expect(rpc).toHaveBeenCalledOnce();
  });
  it('preserves complete25+tail and rejects backward IDs or wrong scope', async () => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...saved, intent_id: id(1000 + n) }));
    rpc.mockResolvedValue(ok({ items, next_cursor: id(1024) })); expect((await loadPendingSubmissionIntents({ ...scope, after: null })).data?.items).toHaveLength(25);
    rpc.mockResolvedValue(ok({ items: [{ ...saved, intent_id: id(1025) }], next_cursor: null }));
    expect((await loadPendingSubmissionIntents({ ...scope, after: id(1024) })).data?.items).toHaveLength(1);
    expect((await loadPendingSubmissionIntents({ ...scope, after: id(1025) })).data).toBeNull();
    rpc.mockResolvedValue(ok({ items: [{ ...saved, patient_id: id(999) }], next_cursor: null }));
    expect((await loadPendingSubmissionIntents({ ...scope, after: null })).data).toBeNull();
  });
});
