import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthorize, mockSubmit, mockRpc, mockRevalidate, mockFrom } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockSubmit: vi.fn(),
  mockRpc: vi.fn(),
  mockRevalidate: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/auth/authorization', () => ({
  authorize: vi.fn(),
  authorizeProviderForPatient: mockAuthorize,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { rpc: mockRpc } }));

import {
  acknowledgeLabSubmission,
  cancelLabSubmission,
  getLabSubmission,
  prepareLabSubmission,
  saveLabResult,
} from '@/lib/dashboard/actions';

const PATIENT_ID = '00000000-0000-4000-a000-000000000001';
const REQUEST_ID = '00000000-0000-4000-a000-000000000002';
const LAB_ID = '00000000-0000-4000-a000-000000000003';
const EVENT_ID = '00000000-0000-4000-a000-000000000004';
const ACTOR_ID = '00000000-0000-4000-a000-000000000099';
const NOW = new Date('2026-09-11T16:00:00.000Z');

function makeForm(fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    patientId: PATIENT_ID,
    requestId: REQUEST_ID,
    collectedAt: '2026-08-01T09:15:00-04:00',
    potassium: '4.5',
    ...fields,
  })) form.set(key, value);
  return form;
}

describe('saveLabResult collection provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockAuthorize.mockResolvedValue({
      authorized: true,
      user: { id: '00000000-0000-4000-a000-000000000099' },
      role: 'provider',
      supabase: { rpc: mockSubmit, from: mockFrom },
    });
    mockSubmit.mockResolvedValue({ data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'pending' }], error: null });
    mockRpc.mockResolvedValue({ data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'not_required' }], error: null });
  });

  afterEach(() => vi.useRealTimers());

  it('preserves historical collection time and lets the database stamp entry time', async () => {
    const result = await saveLabResult(null, makeForm());

    expect(result.success).toBe(true);
    expect(mockSubmit).toHaveBeenCalledWith('submit_lab_result', expect.objectContaining({
      p_request_id: REQUEST_ID,
      p_patient_id: PATIENT_ID,
      p_collected_at: '2026-08-01T09:15:00-04:00',
      p_potassium: 4.5,
    }));
    expect(mockSubmit.mock.calls[0][1]).not.toHaveProperty('created_at');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRevalidate).toHaveBeenCalledWith(`/patients/${PATIENT_ID}`);
  });

  it.each([
    ['UTC', '2026-08-01T13:15:00Z'],
    ['positive offset', '2026-08-01T09:15:00+05:30'],
    ['first repeated DST time', '2025-11-02T01:30:00-04:00'],
    ['second repeated DST time', '2025-11-02T01:30:00-05:00'],
    ['microsecond precision', '2026-08-01T13:15:00.123456Z'],
    ['distinct microsecond', '2026-08-01T13:15:00.123457Z'],
  ])('preserves the explicit instant until database normalization: %s', async (_label, collectedAt) => {
    expect((await saveLabResult(null, makeForm({ collectedAt }))).success).toBe(true);
    expect(mockSubmit).toHaveBeenCalledWith('submit_lab_result', expect.objectContaining({ p_collected_at: collectedAt }));
  });

  it.each([
    ['empty', ''],
    ['malformed', 'yesterday'],
    ['invalid calendar day', '2026-02-30T12:00:00Z'],
    ['date only', '2026-08-01'],
    ['local time without an offset', '2026-08-01T09:15:00'],
    ['future', '2026-09-11T16:00:01Z'],
    ['precision beyond PostgreSQL microseconds', '2026-08-01T13:15:00.1234567Z'],
  ])('rejects %s collection timestamps before persistence', async (_label, collectedAt) => {
    const result = await saveLabResult(null, makeForm({ collectedAt }));
    expect(result.error).toBeTruthy();
    expect(result.success).not.toBe(true);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a missing collection timestamp', async () => {
    const form = makeForm();
    form.delete('collectedAt');
    expect((await saveLabResult(null, form)).error).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('rejects a draw with no numeric analyte, even when notes were entered', async () => {
    const result = await saveLabResult(null, makeForm({ potassium: '', notes: 'Historical draw' }));
    expect(result.error).toMatch(/at least one lab value/i);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('preserves an explicitly partial draw without inventing other results', async () => {
    const result = await saveLabResult(null, makeForm({ potassium: '', creatinine: '1.1' }));
    expect(result.success).toBe(true);
    expect(mockSubmit).toHaveBeenCalledWith('submit_lab_result', expect.objectContaining({
      p_potassium: null, p_egfr: null, p_sodium: null, p_creatinine: 1.1,
    }));
  });

  it('still requires patient authorization and never writes on denial', async () => {
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'Unauthorized' });
    expect((await saveLabResult(null, makeForm())).error).toBe('Unauthorized');
    expect(mockAuthorize).toHaveBeenCalledWith(PATIENT_ID);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(['', 'not-a-uuid'])('rejects invalid submission identity %s before writing', async (requestId) => {
    expect((await saveLabResult(null, makeForm({ requestId }))).error).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['potassium', '5.54'], ['egfr', '14.9'], ['creatinine', '1.123'], ['sodium', '140.12'],
  ])('rejects precision that storage would silently change: %s', async (field, value) => {
    const result = await saveLabResult(null, makeForm({ [field]: value }));
    expect(result.status).toBe('not_saved');
    expect(result.error).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['potassium', '5.5', 'p_potassium', 5.5],
    ['potassium', '5.6', 'p_potassium', 5.6],
    ['egfr', '15', 'p_egfr', 15],
    ['egfr', '14', 'p_egfr', 14],
    ['creatinine', '1.13', 'p_creatinine', 1.13],
    ['sodium', '140.1', 'p_sodium', 140.1],
  ])('preserves representable %s=%s without rounding', async (field, value, arg, expected) => {
    expect((await saveLabResult(null, makeForm({ [field]: String(value) }))).success).toBe(true);
    expect(mockSubmit).toHaveBeenCalledWith('submit_lab_result', expect.objectContaining({ [arg]: expected }));
  });

  it('uses the original submission identity on an explicit repeated save', async () => {
    const form = makeForm();
    await saveLabResult(null, form);
    await saveLabResult(null, form);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit.mock.calls[1]).toEqual(mockSubmit.mock.calls[0]);
    expect(mockFrom).not.toHaveBeenCalled();
    // Atomic deduplication itself is exercised by lab_result_outbox.sql.
  });

  it.each(['recorded', 'not_required'])('does not reprocess a terminal receipt: %s', async (status) => {
    mockSubmit.mockResolvedValue({ data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status }], error: null });
    const result = await saveLabResult(null, makeForm());
    expect(result).toMatchObject({ success: true, status: 'saved', labResultId: LAB_ID, eventId: EVENT_ID, alertStatus: status });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('reports an interrupted save as unconfirmed, not definitely absent', async () => {
    mockSubmit.mockRejectedValue(new Error('private transport detail'));
    const result = await saveLabResult(null, makeForm());
    expect(result).toMatchObject({ success: false, status: 'save_unconfirmed' });
    expect(result.error).toMatch(/same submission/i);
    expect(result.error).toMatch(/without resending/i);
    expect(JSON.stringify(result)).not.toContain('private transport detail');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'private database detail' } },
    { data: [], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: null, status: 'pending' }], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'delivered' }], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'pending' }, { lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'pending' }], error: null },
  ])('does not invent a durable receipt from an invalid submission response', async (response) => {
    mockSubmit.mockResolvedValue(response);
    const result = await saveLabResult(null, makeForm());
    expect(result.status).toBe('save_unconfirmed');
    expect(result.success).not.toBe(true);
    expect(result.labResultId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('private database detail');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('preserves the saved receipt when subsequent alert processing throws', async () => {
    mockRpc.mockRejectedValue(new Error('private failure'));
    const result = await saveLabResult(null, makeForm({ potassium: '6.2' }));
    expect(result).toMatchObject({ success: false, status: 'saved_alert_pending', labResultId: LAB_ID, eventId: EVENT_ID, alertStatus: 'pending' });
    expect(JSON.stringify(result)).not.toContain('private failure');
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('process_lab_alert_event', { p_lab_result_id: LAB_ID });
    expect(mockRevalidate).toHaveBeenCalledWith(`/patients/${PATIENT_ID}`);
  });
});

describe('durable laboratory submission recovery actions', () => {
  const preparedRow = {
    request_id: REQUEST_ID, submission_status: 'prepared',
    lab_result_id: null, event_id: null, alert_status: null, collected_at: null,
    potassium: null, egfr: null, creatinine: null, sodium: null, notes: null, is_new: false,
  };
  const savedRow = {
    ...preparedRow, submission_status: 'committed', lab_result_id: LAB_ID,
    event_id: EVENT_ID, alert_status: 'not_required',
    collected_at: '2020-01-01T12:00:00.123456+00:00', potassium: 4.5,
  };
  const calls = [
    ['read', () => getLabSubmission({ patientId: PATIENT_ID })],
    ['prepare', () => prepareLabSubmission({ patientId: PATIENT_ID })],
    ['acknowledge', () => acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID, labResultId: LAB_ID })],
    ['cancel', () => cancelLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID })],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({
      authorized: true, user: { id: ACTOR_ID }, role: 'provider',
      supabase: { rpc: mockSubmit, from: mockFrom },
    });
    mockSubmit.mockResolvedValue({ data: [preparedRow], error: null });
  });

  it('reads no active attempt only from a confirmed empty result, without preparing or processing', async () => {
    mockSubmit.mockResolvedValue({ data: [], error: null });
    expect(await getLabSubmission({ patientId: PATIENT_ID })).toEqual({ success: true, actorId: ACTOR_ID, submission: null });
    expect(mockSubmit).toHaveBeenCalledExactlyOnceWith('get_lab_submission', { p_patient_id: PATIENT_ID, p_request_id: null });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it('returns a minimal saved receipt and preserves microseconds, without retransmitting or evaluating the exam', async () => {
    mockSubmit.mockResolvedValue({ data: [{ ...savedRow, private_debug: 'not for the client' }], error: null });
    const result = await getLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID });
    expect(result).toEqual({ success: true, actorId: ACTOR_ID, submission: {
      requestId: REQUEST_ID, status: 'committed', labResultId: LAB_ID, eventId: EVENT_ID,
      alertStatus: 'not_required', collectedAt: savedRow.collected_at,
      potassium: 4.5, egfr: null, creatinine: null, sodium: null, notes: null, isNew: false,
    } });
    expect(mockSubmit).toHaveBeenCalledExactlyOnceWith('get_lab_submission', { p_patient_id: PATIENT_ID, p_request_id: REQUEST_ID });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it.each(['pending', 'recorded', 'not_required'])('keeps receipt confirmation distinct from %s alert evaluation', async (alert_status) => {
    mockSubmit.mockResolvedValue({ data: [{ ...savedRow, alert_status }], error: null });
    expect(await getLabSubmission({ patientId: PATIENT_ID })).toMatchObject({ success: true, submission: { status: 'committed', alertStatus: alert_status } });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('prepares an identity on the authenticated connection, not a clinical record', async () => {
    mockSubmit.mockResolvedValue({ data: [{ ...preparedRow, is_new: true }], error: null });
    expect(await prepareLabSubmission({ patientId: PATIENT_ID })).toMatchObject({ success: true, actorId: ACTOR_ID, submission: { requestId: REQUEST_ID, status: 'prepared', isNew: true } });
    expect(mockSubmit).toHaveBeenCalledExactlyOnceWith('prepare_lab_submission', { p_patient_id: PATIENT_ID });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([preparedRow, savedRow])('prepare recovers an existing attempt without replacing its identity', async (row) => {
    mockSubmit.mockResolvedValue({ data: [row], error: null });
    expect(await prepareLabSubmission({ patientId: PATIENT_ID })).toMatchObject({ success: true, submission: { requestId: REQUEST_ID, isNew: false } });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('acknowledges only the exact saved receipt, not alert evaluation or clinical review', async () => {
    mockSubmit.mockResolvedValue({ data: [{ ...savedRow, submission_status: 'acknowledged', alert_status: 'pending' }], error: null });
    expect(await acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID, labResultId: LAB_ID })).toMatchObject({ success: true, submission: { status: 'acknowledged', alertStatus: 'pending' } });
    expect(mockSubmit).toHaveBeenCalledExactlyOnceWith('acknowledge_lab_submission', { p_patient_id: PATIENT_ID, p_request_id: REQUEST_ID, p_lab_result_id: LAB_ID });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidate).toHaveBeenCalledExactlyOnceWith(`/patients/${PATIENT_ID}`);
  });

  it('recovers an acknowledged receipt after a lost acknowledgement response', async () => {
    mockSubmit.mockRejectedValueOnce(new Error('private network error'));
    expect(await acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID, labResultId: LAB_ID })).toMatchObject({ success: false });
    mockSubmit.mockResolvedValue({ data: [{ ...savedRow, submission_status: 'acknowledged' }], error: null });
    expect(await getLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID })).toMatchObject({ success: true, submission: { status: 'acknowledged', requestId: REQUEST_ID } });
    expect(mockSubmit.mock.calls.map(([name]) => name)).toEqual(['acknowledge_lab_submission', 'get_lab_submission']);
  });

  it.each(['cancelled', 'committed', 'acknowledged'])('returns actual %s when cancelling rather than assuming no exam exists', async (status) => {
    const row = status === 'cancelled' ? preparedRow : savedRow;
    mockSubmit.mockResolvedValue({ data: [{ ...row, submission_status: status }], error: null });
    expect(await cancelLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID })).toMatchObject({ success: true, submission: { status } });
    expect(mockSubmit).toHaveBeenCalledExactlyOnceWith('cancel_lab_submission', { p_patient_id: PATIENT_ID, p_request_id: REQUEST_ID });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each(calls)('%s rejects current authorization denial before querying or creating anything', async (_name, action) => {
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'MFA required' });
    expect(await action()).toEqual({ success: false, error: 'MFA required' });
    expect(mockAuthorize).toHaveBeenCalledExactlyOnceWith(PATIENT_ID);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it.each(calls)('%s fails closed on an authorization transport exception', async (_name, action) => {
    mockAuthorize.mockRejectedValue(new Error('private auth details'));
    const result = await action();
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private auth details');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each(calls)('%s never treats a missing/failed response as absence or successful completion', async (_name, action) => {
    for (const response of [{ data: null, error: null }, { data: [], error: { message: 'private SQL details' } }]) {
      mockSubmit.mockResolvedValue(response);
      const result = await action();
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('private SQL details');
    }
    mockSubmit.mockRejectedValue(new Error('private transport details'));
    const result = await action();
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('private transport details');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it('does not accept no rows for an explicit attempt or any mutating action', async () => {
    mockSubmit.mockResolvedValue({ data: [], error: null });
    for (const action of [
      () => getLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID }),
      ...calls.slice(1).map(([, action]) => action),
    ]) expect((await action()).success).toBe(false);
  });

  it('validates all supplied identities before authorization', async () => {
    const results = await Promise.all([
      getLabSubmission({ patientId: 'bad' }),
      getLabSubmission({ patientId: PATIENT_ID, requestId: 'bad' }),
      prepareLabSubmission({ patientId: 'bad' }),
      acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: 'bad', labResultId: LAB_ID }),
      acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID, labResultId: 'bad' }),
      cancelLabSubmission({ patientId: PATIENT_ID, requestId: 'bad' }),
    ]);
    expect(results.every((result) => !result.success)).toBe(true);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it.each([
    { ...savedRow, request_id: PATIENT_ID },
    { ...savedRow, lab_result_id: null },
    { ...savedRow, event_id: null },
    { ...savedRow, collected_at: 'infinity' },
    { ...savedRow, alert_status: 'delivered' },
    { ...savedRow, potassium: Infinity },
    { ...savedRow, potassium: null },
    { ...preparedRow, potassium: 4.5 },
    { ...preparedRow, submission_status: 'cancelled', lab_result_id: LAB_ID },
    { ...savedRow, is_new: true },
  ])('rejects a mismatched or internally inconsistent explicit recovery row', async (row) => {
    mockSubmit.mockResolvedValue({ data: [row], error: null });
    expect((await getLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID })).success).toBe(false);
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it('rejects multiple active rows and a terminal row returned as active', async () => {
    mockSubmit.mockResolvedValue({ data: [preparedRow, preparedRow], error: null });
    expect((await getLabSubmission({ patientId: PATIENT_ID })).success).toBe(false);
    mockSubmit.mockResolvedValue({ data: [{ ...preparedRow, submission_status: 'cancelled' }], error: null });
    expect((await getLabSubmission({ patientId: PATIENT_ID })).success).toBe(false);
  });

  it('does not accept acknowledgement of a different lab or a non-acknowledged response', async () => {
    for (const row of [savedRow, { ...savedRow, submission_status: 'acknowledged', lab_result_id: PATIENT_ID }]) {
      mockSubmit.mockResolvedValue({ data: [row], error: null });
      expect((await acknowledgeLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID, labResultId: LAB_ID })).success).toBe(false);
    }
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it('does not accept prepared as a cancellation or terminal as a preparation', async () => {
    expect((await cancelLabSubmission({ patientId: PATIENT_ID, requestId: REQUEST_ID })).success).toBe(false);
    mockSubmit.mockResolvedValue({ data: [{ ...savedRow, submission_status: 'acknowledged' }], error: null });
    expect((await prepareLabSubmission({ patientId: PATIENT_ID })).success).toBe(false);
  });
});
