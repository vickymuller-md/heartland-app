import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitBatchVitalsAsProvider } from '@/lib/vitals/actions';
import { acknowledgeVitalsBatch, cancelVitalsBatch, prepareVitalsBatch, recoverVitalsBatch } from '@/lib/vitals/batch-actions';
import { parseBatchFormData, isBlankRow } from '@/lib/vitals/batch-schema';

const { auth, rpc, recover } = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), recover: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: auth }));
vi.mock('@/lib/vitals/submission-actions', () => ({ recoverVitalsSubmission: recover, submitCapturedVitals: vi.fn(), submitCapturedProviderVitals: vi.fn() }));
const id = (n: number) => `46000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const patientId = id(11), batchId = id(20);
const rawReceipt = (n: number) => ({ request_id: id(n), submission_status: 'batched', vitals_id: id(n + 100), symptoms_id: id(n + 200),
  evaluation_status: 'pending', red_flag_ids: null, alert_id: null, rule_version: null,
  observation: { vitals: { id: id(n + 100), patient_id: patientId, recorded_at: '2026-09-22T12:00:00Z',
    weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 70, spo2: null, source: 'provider_entry' } } });
const rawBatch = (status = 'committed', count = 2) => ({ mode: 'batch', batch_id: batchId, submission_status: status,
  rows: ['prepared', 'cancelled'].includes(status) ? [] : Array.from({ length: count }, (_, i) => ({ row_index: i, receipt: rawReceipt(30 + i) })) });
function form(count = 2) {
  const data = new FormData(); data.set('patientId', patientId); data.set('batchId', batchId);
  for (let i = 0; i < count; i++) for (const [key, value] of Object.entries({
    weight: '180', weightUnit: 'lbs', sbp: '120', dbp: '80', heartRate: '70', spo2: '', dyspnea: '0', recordedAt: '2026-09-22',
  })) data.set(`row_${i}_${key}`, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ authorized: true, user: { id: id(1) }, role: 'provider', supabase: { rpc } });
  rpc.mockResolvedValue({ data: rawBatch(), error: null });
  recover.mockImplementation(async (_patient: string, request: string) => ({
    requestId: request, saved: true, success: true, submissionStatus: 'batched', evaluationStatus: 'complete',
    vitals: rawReceipt(Number(request.slice(-12))).observation.vitals, symptomsId: id(Number(request.slice(-12)) + 200), redFlags: [],
  }));
});

describe('durable batch actions', () => {
  it.each(['Not authenticated', 'Unauthorized'])('rejects %s before any capture', async (error) => {
    auth.mockResolvedValue({ authorized: false, error });
    expect((await submitBatchVitalsAsProvider(null, form())).error).toBe(error);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires a prepared identity, not a new UUID on every save', async () => {
    const data = form(); data.delete('batchId');
    expect((await submitBatchVitalsAsProvider(null, data)).error).toContain('Prepare or recover');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('submits all selected rows in one atomic call, preserving original kg units', async () => {
    const data = form(); data.set('row_1_weight', '82'); data.set('row_1_weightUnit', 'kg');
    const result = await submitBatchVitalsAsProvider(null, data);
    expect(result.saved).toBe(true); expect(result.results).toHaveLength(7);
    expect(result.results?.filter((row) => row.success)).toHaveLength(2);
    expect(result.results?.filter((row) => row.skipped)).toHaveLength(5);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0]; expect(name).toBe('submit_vitals_batch');
    expect(args).toMatchObject({ p_patient_id: patientId, p_batch_id: batchId });
    expect(args.p_rows).toHaveLength(7);
    expect(args.p_rows[1]).toMatchObject({ weight: 82, weight_unit: 'kg', recorded_at: '2026-09-22T12:00:00Z' });
    expect(args.p_rows.slice(2)).toEqual([null, null, null, null, null]);
  });
  it('supports five filled rows and two intentionally blank positions', async () => {
    rpc.mockResolvedValue({ data: rawBatch('committed', 5), error: null });
    const result = await submitBatchVitalsAsProvider(null, form(5));
    expect(result.results?.filter((row) => row.success)).toHaveLength(5);
    expect(result.results?.filter((row) => row.skipped)).toHaveLength(2);
  });
  it.each([['spo2', '85'], ['dyspnea', '3'], ['weight', '12']])('rejects invalid last row %s before any capture', async (key, value) => {
    rpc.mockResolvedValue({ data: rawBatch('prepared'), error: null });
    const data = form(); data.set(`row_6_${key}`, value); data.set('row_6_recordedAt', '2026-09-23');
    const result = await submitBatchVitalsAsProvider(null, data);
    expect(result.error).toContain('No new rows were saved'); expect(result.results?.[0].rowIndex).toBe(6);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_vitals_batch']);
  });
  it('rejects all blank before writing', async () => {
    rpc.mockResolvedValue({ data: rawBatch('prepared'), error: null });
    expect((await submitBatchVitalsAsProvider(null, form(0))).error).toContain('at least one');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_vitals_batch']);
  });
  it('recovers another tab capture even when this stale form is invalid', async () => {
    const data = form(); data.set('row_0_weight', '0');
    const result = await submitBatchVitalsAsProvider(null, data);
    expect(result.saved).toBe(true); expect(result.error).toContain('invalid current form values were not saved');
    expect(result.submissionStatus).toBe('committed');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_vitals_batch']);
  });
  it('does not invent prepared state if recovery after validation failure is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    const result = await submitBatchVitalsAsProvider(null, form(0));
    expect(result.errorKind).toBe('unavailable'); expect(result.submissionStatus).toBeUndefined();
    expect(result.saved).not.toBe(true);
  });
  it('evaluates rows independently by stable request ID, not current dates or row index', async () => {
    recover.mockResolvedValueOnce({ saved: true, success: false, requestId: id(30), evaluationStatus: 'failed',
      vitals: rawReceipt(30).observation.vitals, redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low oxygen', action: 'Seek urgent evaluation' }] });
    const result = await submitBatchVitalsAsProvider(null, form());
    expect(recover.mock.calls).toEqual([[patientId, id(30)], [patientId, id(31)]]);
    expect(result.anyRedFlags).toBe(true); expect(result.results?.[0].success).toBe(false);
    expect(result.results?.[0].receipt?.saved).toBe(true); expect(result.results?.[1].success).toBe(true);
  });
  it('recovers response loss without a second capture or new identity', async () => {
    rpc.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ data: rawBatch(), error: null });
    const result = await submitBatchVitalsAsProvider(null, form());
    expect(result.saved).toBe(true); expect(result.error).toContain('changed form values were not saved');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['submit_vitals_batch', 'get_vitals_batch']);
    expect(rpc.mock.calls[1][1].p_batch_id).toBe(batchId);
  });
  it('retains saved state if a row evaluation read fails transiently', async () => {
    recover.mockResolvedValue({ errorKind: 'unavailable', error: 'temporarily unavailable' });
    const result = await recoverVitalsBatch(patientId, batchId);
    expect(result.saved).toBe(true); expect(result.results?.[0].receipt?.saved).toBe(true);
    expect(result.results?.[0].success).toBe(false);
  });
  it('preserves a critical earlier result when a later row throws during recovery', async () => {
    recover.mockResolvedValueOnce({ saved: true, requestId: id(30), evaluationStatus: 'failed',
      vitals: rawReceipt(30).observation.vitals,
      redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low oxygen', action: 'Seek urgent evaluation' }] })
      .mockRejectedValueOnce(new Error('session network failure'));
    const result = await recoverVitalsBatch(patientId, batchId);
    expect(result.saved).toBe(true); expect(result.anyRedFlags).toBe(true);
    expect(result.results?.[0].redFlags[0].id).toBe('spo2_low');
    expect(result.results?.[1].receipt?.saved).toBe(true); expect(result.results?.[1].success).toBe(false);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_vitals_batch']);
  });
  it('clears batch data when access is revoked during row evaluation', async () => {
    recover.mockResolvedValue({ errorKind: 'access', error: 'Unauthorized' });
    expect(await recoverVitalsBatch(patientId, batchId)).toEqual({ errorKind: 'access', error: 'Unauthorized' });
  });
  it('does not show a failed initial query as empty batch', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    expect((await recoverVitalsBatch(patientId)).errorKind).toBe('unavailable');
  });
  it('reports the competing active individual mode explicitly', async () => {
    rpc.mockResolvedValue({ data: { mode: 'individual' }, error: null });
    expect((await recoverVitalsBatch(patientId)).activeIndividual).toBe(true);
  });
  it('prepare recovers an already committed batch without a new save', async () => {
    expect((await prepareVitalsBatch(patientId)).saved).toBe(true);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['prepare_vitals_batch']);
  });
  it('ACK transmits the exact request set, never marks clinical review', async () => {
    rpc.mockResolvedValue({ data: rawBatch('acknowledged'), error: null });
    expect((await acknowledgeVitalsBatch(patientId, batchId, [id(30), id(31)])).submissionStatus).toBe('acknowledged');
    expect(rpc).toHaveBeenCalledWith('acknowledge_vitals_batch', { p_patient_id: patientId, p_batch_id: batchId, p_request_ids: [id(30), id(31)] });
  });
  it.each([{ ids: [] }, { ids: [id(30), id(30)] }])('rejects empty/duplicate ACK %j', async ({ ids }) => {
    expect((await acknowledgeVitalsBatch(patientId, batchId, ids)).error).toBeDefined(); expect(rpc).not.toHaveBeenCalled();
  });
  it('cancel after concurrent save returns saved batch rather than erasing it', async () => {
    expect((await cancelVitalsBatch(patientId, batchId)).saved).toBe(true);
  });
});

describe('seven-position form parsing', () => {
  it('extracts seven stable positions and keeps dates', () => {
    const rows = parseBatchFormData(form(7)); expect(rows).toHaveLength(7);
    expect(rows[6]).toMatchObject({ weight: '180', recordedAt: '2026-09-22' });
  });
  it('date/unit defaults alone are blank', () => {
    expect(isBlankRow({ recordedAt: '2026-09-22', weightUnit: 'lbs', dyspnea: '0' })).toBe(true);
  });
  it.each([{ spo2: '85' }, { dyspnea: '3' }, { spo2: '0' }, { dyspnea: 'invalid' }, { weight: '180' }])(
    'does not discard isolated input %j', (row) => expect(isBlankRow({ dyspnea: '0', ...row })).toBe(false),
  );
});
