import { beforeEach, describe, expect, it, vi } from 'vitest';
const { auth, providerAuth, rpc, adminRpc, readReceipt } = vi.hoisted(() => ({
  auth: vi.fn(), providerAuth: vi.fn(), rpc: vi.fn(), adminRpc: vi.fn(), readReceipt: vi.fn(),
}));
vi.mock('@/lib/auth/authorization', () => ({ authorize: auth, authorizeProviderForPatient: providerAuth }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: adminRpc } }));
import { submitCapturedVitals, submitCapturedProviderVitals, prepareVitalsSubmission,
  recoverVitalsSubmission, acknowledgeVitalsSubmission, cancelVitalsSubmission } from '@/lib/vitals/submission-actions';
import { VITALS_RULE_VERSION, BATCH_VITALS_RULE_VERSION } from '@/lib/vitals/receipt-evaluation';

const actor = '45000000-0000-4000-8000-000000000001';
const patient = '45000000-0000-4000-8000-000000000011';
const request = '45000000-0000-4000-8000-000000000021';
const vitalId = '45000000-0000-4000-8000-000000000031';
const symptomId = '45000000-0000-4000-8000-000000000041';
const alertId = '45000000-0000-4000-8000-000000000051';
const clock = '2026-09-23T12:00:00.000Z';
const vitals = { id: vitalId, patient_id: patient, recorded_at: clock, weight_lbs: 180,
  sbp: 120, dbp: 80, heart_rate: 70, spo2: 90, source: 'provider_entry' };
const symptoms = { id: symptomId, patient_id: patient, recorded_at: clock,
  dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0, red_flag: null };
let snapshot: Record<string, unknown>;
let from: ReturnType<typeof vi.fn>;
function form(overrides: Record<string,string> = {}) {
  const value = new FormData();
  for (const [key, entry] of Object.entries({ patientId: patient, requestId: request, weight: '180', weightUnit: 'lbs',
    sbp: '120', dbp: '80', heartRate: '70', spo2: '90', dyspnea: '0', edema: '0', orthopnea: 'false', fatigue: '0', ...overrides })) value.set(key, entry);
  return value;
}
beforeEach(() => {
  vi.resetAllMocks();
  snapshot = { request_id: request, submission_status: 'committed', vitals_id: vitalId, symptoms_id: symptomId,
    evaluation_status: 'pending', red_flag_ids: null, alert_id: null, rule_version: null,
    observation: { vitals, symptoms }, captured_at: clock };
  from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ single: readReceipt })) })) }));
  auth.mockResolvedValue({ authorized: true, user: { id: patient }, role: 'patient', supabase: { rpc, from } });
  providerAuth.mockResolvedValue({ authorized: true, user: { id: actor }, role: 'provider', supabase: { rpc, from } });
  readReceipt.mockResolvedValue({ data: { context_version: 1, captured_at: clock, observation: { vitals, symptoms }, history: [] }, error: null });
  rpc.mockImplementation(async () => ({ data: structuredClone(snapshot), error: null }));
  adminRpc.mockImplementation(async (_name, args) => {
    snapshot = { ...snapshot, evaluation_status: 'complete', red_flag_ids: args.p_flags,
      rule_version: args.p_rule_version, alert_id: args.p_flags.length ? alertId : null };
    return { data: { status: 'complete' }, error: null };
  });
});

describe('recoverable vitals actions', () => {
  it('dispatches batched receipts to their immutable prior-only context', async () => {
    snapshot.submission_status = 'batched';
    const result = await recoverVitalsSubmission(patient, request);
    expect(result.success).toBe(true);
    expect(from.mock.calls.map((call) => call[0])).toEqual(['vitals_submission_receipts', 'vitals_submission_batch_rows']);
    expect(adminRpc).toHaveBeenCalledWith('finalize_vitals_submission_evaluation', expect.objectContaining({ p_rule_version: BATCH_VITALS_RULE_VERSION }));
  });
  it('does not substitute an individual recipe when batch context is unavailable', async () => {
    snapshot.submission_status = 'batched';
    readReceipt.mockResolvedValueOnce({ data: { context_version: 1, captured_at: clock, observation: { vitals, symptoms }, history: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'unavailable' } });
    expect((await recoverVitalsSubmission(patient, request)).success).not.toBe(true);
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('reports a competing active batch rather than showing an empty individual slot', async () => {
    rpc.mockResolvedValue({ data: { mode: 'batch', batch_id: request }, error: null });
    expect((await recoverVitalsSubmission(patient)).activeBatchId).toBe(request);
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('cancel racing with committed capture returns its receipt rather than clearing it', async () => {
    const result = await cancelVitalsSubmission(request, patient);
    expect(result.saved).toBe(true);
    expect(rpc).toHaveBeenCalledWith('cancel_vitals_submission', { p_patient_id: patient, p_request_id: request });
  });
  it.each(['Not authenticated','Unauthorized','Consent required','MFA required'])('provider rejection %s performs no persistence', async (error) => {
    providerAuth.mockResolvedValue({ authorized: false, error });
    expect(await submitCapturedProviderVitals(null, form())).toEqual({ error });
    expect(rpc).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });
  it('requires a prepared identity before capture', async () => {
    const data = form(); data.delete('requestId');
    expect((await submitCapturedProviderVitals(null, data)).error).toMatch(/prepare/i);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('invalid patient id does not become a patient self-entry', async () => {
    expect((await submitCapturedProviderVitals(null, form({ patientId: '' }))).error).toBe('Invalid patient ID');
    expect(auth).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('validates measurements before any capture', async () => {
    expect((await submitCapturedProviderVitals(null, form({ weight: 'NaN' }))).errors?.weight).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('uses atomic RPC with original unit and explicit provider patient, never separate inserts', async () => {
    const result = await submitCapturedProviderVitals(null, form({ weight: '80', weightUnit: 'kg', recordedAt: '2026-03-20T12:00:00Z' }));
    expect(result).toMatchObject({ saved: true, success: true, requestId: request, evaluationStatus: 'complete', alertRecorded: true });
    expect(rpc).toHaveBeenCalledWith('submit_vitals_submission', expect.objectContaining({
      p_patient_id: patient, p_request_id: request, p_weight: 80, p_weight_unit: 'kg', p_recorded_at: '2026-03-20T12:00:00Z',
    }));
    expect(adminRpc).toHaveBeenCalledWith('finalize_vitals_submission_evaluation', {
      p_actor_id: actor, p_request_id: request, p_rule_version: VITALS_RULE_VERSION, p_flags: ['spo2_low'],
    });
    expect(from.mock.calls.map((call) => call[0])).toEqual(['vitals_submission_receipts']);
  });
  it('patient identity and recorded time are not taken from the form', async () => {
    await submitCapturedVitals(null, form({ patientId: actor, recordedAt: clock }));
    expect(auth).toHaveBeenCalledWith('patient');
    expect(rpc).toHaveBeenCalledWith('submit_vitals_submission', expect.objectContaining({ p_patient_id: patient, p_recorded_at: null }));
  });
  it('saved observation and critical instructions survive failed alert persistence', async () => {
    adminRpc.mockResolvedValue({ data: { status: 'failed' }, error: null });
    const result = await submitCapturedProviderVitals(null, form());
    expect(result.saved).toBe(true); expect(result.success).not.toBe(true);
    expect(result.evaluationStatus).toBe('failed'); expect(result.redFlags?.[0].id).toBe('spo2_low');
    expect(result.error).toMatch(/saved.*not confirmed/i);
  });
  it('a lost capture response recovers the same receipt without another capture', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    const result = await submitCapturedProviderVitals(null, form());
    expect(result.saved).toBe(true);
    expect(rpc.mock.calls.filter(([name]) => name === 'submit_vitals_submission')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('get_vitals_submission', { p_patient_id: patient, p_request_id: request });
  });
  it('a changed-payload conflict surfaces the previous saved record, not a new write', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505' } });
    const result = await submitCapturedProviderVitals(null, form({ weight: '181' }));
    expect(result.saved).toBe(true); expect(result.error).toMatch(/changed form values were not saved/);
  });
  it('reload retries only evaluation on the authorized frozen receipt', async () => {
    const result = await recoverVitalsSubmission(patient);
    expect(result.success).toBe(true);
    expect(rpc.mock.calls.every(([name]) => name === 'get_vitals_submission')).toBe(true);
    expect(readReceipt).toHaveBeenCalledTimes(1);
  });
  it('completed reload does not run or finalize the engine again', async () => {
    snapshot = { ...snapshot, evaluation_status: 'complete', rule_version: VITALS_RULE_VERSION, red_flag_ids: ['spo2_low'], alert_id: alertId };
    expect((await recoverVitalsSubmission(patient)).success).toBe(true);
    expect(readReceipt).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });
  it('load errors do not masquerade as no active receipt', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect((await recoverVitalsSubmission(patient)).error).toMatch(/before creating another/);
  });
  it('missing history remains pending and does not silently evaluate normal', async () => {
    readReceipt.mockResolvedValue({ data: null, error: { code: '42501' } });
    const result = await recoverVitalsSubmission(patient);
    expect(result).toMatchObject({ saved: true, evaluationStatus: 'pending' });
    expect(result.success).not.toBe(true); expect(adminRpc).not.toHaveBeenCalled();
  });
  it('null history retains independent critical flags without claiming complete evaluation', async () => {
    readReceipt.mockResolvedValue({ data: { context_version: 1, captured_at: clock, observation: { vitals, symptoms },
      history: [{ id: alertId, recorded_at: clock, weight_lbs: null }] }, error: null });
    const result = await recoverVitalsSubmission(patient);
    expect(result.redFlags?.[0].id).toBe('spo2_low'); expect(result.success).not.toBe(true);
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it('a service success without authorized readback is not displayed as success', async () => {
    rpc.mockResolvedValueOnce({ data: structuredClone(snapshot), error: null }).mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect((await recoverVitalsSubmission(patient)).success).not.toBe(true);
  });
  it('prepare recovers an existing committed slot without another capture', async () => {
    expect((await prepareVitalsSubmission(patient)).saved).toBe(true);
    expect(rpc.mock.calls.filter(([name]) => name === 'submit_vitals_submission')).toHaveLength(0);
  });
  it('ack uses all exact IDs, and is not a clinical acknowledgement', async () => {
    snapshot.submission_status = 'acknowledged';
    expect((await acknowledgeVitalsSubmission(request, vitalId, symptomId, patient)).submissionStatus).toBe('acknowledged');
    expect(rpc).toHaveBeenCalledWith('acknowledge_vitals_submission', {
      p_patient_id: patient, p_request_id: request, p_vitals_id: vitalId, p_symptoms_id: symptomId,
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
