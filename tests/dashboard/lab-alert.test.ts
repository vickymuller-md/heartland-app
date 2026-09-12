/**
 * Lab alert persistence/recovery Server Action contracts.
 * Real threshold, rollback and idempotency behavior is tested in pgTAP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock server-only (throws in non-server context)
vi.mock('server-only', () => ({}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ---------- Supabase mock setup ----------

const mockFrom = vi.fn();
const mockSubmit = vi.fn();
const mockLookup = vi.fn();
const mockAuthorizeProviderForPatient = vi.fn();

vi.mock('@/lib/auth/authorization', () => ({
  authorize: vi.fn(),
  authorizeProviderForPatient: (...args: unknown[]) =>
    mockAuthorizeProviderForPatient(...args),
}));

// Admin client (for alert insert bypassing RLS)
const mockAdminFrom = vi.fn();
const mockAdminRpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockAdminFrom(...args),
    rpc: (...args: unknown[]) => mockAdminRpc(...args),
  },
}));

// Mock constants
vi.mock('@/lib/dashboard/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    PROACTIVE_DEDUP_HOURS: { hyperkalemia: 24, low_egfr: 24 },
  };
});

// This static import works because mocks are in place
import { saveLabResult, retryLabAlerts } from '@/lib/dashboard/actions';

// ---------- Helpers ----------

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set('collectedAt', '2026-08-01T12:00:00Z');
  fd.set('requestId', '00000000-0000-4000-a000-000000000002');
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

const PATIENT_ID = '00000000-0000-4000-a000-000000000001';
const USER_ID = '00000000-0000-4000-a000-000000000099';
const LAB_ID = '00000000-0000-4000-a000-000000000003';
const EVENT_ID = '00000000-0000-4000-a000-000000000004';

// ---------- Tests ----------

describe('saveLabResult -- SAFE-04', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthorizeProviderForPatient.mockResolvedValue({
      authorized: true,
      user: { id: USER_ID },
      role: 'provider',
      supabase: {
        from: (...args: unknown[]) => mockFrom(...args),
        rpc: mockSubmit,
      },
    });

    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: mockLookup };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    mockFrom.mockReturnValue(query);
    mockLookup.mockResolvedValue({ data: { id: EVENT_ID, lab_result_id: LAB_ID, patient_id: PATIENT_ID, status: 'pending' }, error: null });
    mockSubmit.mockResolvedValue({ data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'pending' }], error: null });
    mockAdminRpc.mockResolvedValue({
      data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'recorded' }],
      error: null,
    });
  });

  it('processes the persisted lab identity, not a caller-supplied flag or time', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.2',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockAdminRpc).toHaveBeenCalledWith('process_lab_alert_event', { p_lab_result_id: LAB_ID });
    expect(result).toMatchObject({ status: 'saved', alertStatus: 'recorded', labResultId: LAB_ID, eventId: EVENT_ID });
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it('submits eGFR without silently deriving an alternate alert rule in JavaScript', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      egfr: '10',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockSubmit).toHaveBeenCalledWith('submit_lab_result', expect.objectContaining({ p_egfr: 10 }));
    expect(mockAdminRpc).toHaveBeenCalledWith('process_lab_alert_event', { p_lab_result_id: LAB_ID });
  });

  it('uses the database no-alert outcome without claiming delivery or human review', async () => {
    mockAdminRpc.mockResolvedValue({ data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'not_required' }], error: null });
    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '5.0',
      egfr: '40',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(result.alertStatus).toBe('not_required');
    expect(result).not.toHaveProperty('delivered');
    expect(result).not.toHaveProperty('reviewed');
  });

  it('retries a scoped persisted evaluation without resubmitting the lab', async () => {
    const result = await retryLabAlerts({ patientId: PATIENT_ID, labResultId: LAB_ID });
    expect(result.success).toBe(true);
    expect(mockAuthorizeProviderForPatient).toHaveBeenCalledWith(PATIENT_ID);
    expect(mockFrom).toHaveBeenCalledWith('lab_alert_evaluations');
    expect(mockFrom.mock.results[0].value.eq).toHaveBeenCalledWith('patient_id', PATIENT_ID);
    expect(mockFrom.mock.results[0].value.eq).toHaveBeenCalledWith('lab_result_id', LAB_ID);
    expect(mockAdminRpc).toHaveBeenCalledWith('process_lab_alert_event', { p_lab_result_id: LAB_ID });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('returns error when unauthenticated', async () => {
    mockAuthorizeProviderForPatient.mockResolvedValue({
      authorized: false,
      error: 'Not authenticated',
    });

    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.0',
    });

    const result = await saveLabResult(null, fd);

    expect(result.error).toBe('Not authenticated');
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'secret internal error' } },
    { data: [], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'pending' }], error: null },
    { data: [{ lab_result_id: USER_ID, event_id: EVENT_ID, status: 'recorded' }], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: USER_ID, status: 'recorded' }], error: null },
    { data: [{ lab_result_id: LAB_ID, event_id: EVENT_ID, status: 'delivered' }], error: null },
  ])('retains a durable pending outcome on failed/invalid processing', async (response) => {
    mockAdminRpc.mockResolvedValue(response);
    const result = await saveLabResult(null, makeFormData({ patientId: PATIENT_ID, potassium: '6.2' }));
    expect(result).toMatchObject({ success: false, status: 'saved_alert_pending', labResultId: LAB_ID, eventId: EVENT_ID, alertStatus: 'pending' });
    expect(JSON.stringify(result)).not.toContain('secret internal error');
    expect(mockAdminRpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'private lookup' } },
    { data: { id: EVENT_ID, lab_result_id: LAB_ID, patient_id: USER_ID, status: 'pending' }, error: null },
  ])('never calls the service role when a retry receipt is absent or outside scope', async (response) => {
    mockLookup.mockResolvedValue(response);
    const result = await retryLabAlerts({ patientId: PATIENT_ID, labResultId: LAB_ID });
    expect(result.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('private lookup');
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('rechecks authorization on retries', async () => {
    mockAuthorizeProviderForPatient.mockResolvedValue({ authorized: false, error: 'MFA required' });
    expect((await retryLabAlerts({ patientId: PATIENT_ID, labResultId: LAB_ID })).error).toBe('MFA required');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('rejects malformed retry identifiers before authorization', async () => {
    expect((await retryLabAlerts({ patientId: PATIENT_ID, labResultId: 'bad-id' })).error).toBeTruthy();
    expect(mockAuthorizeProviderForPatient).not.toHaveBeenCalled();
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('does not refresh a terminal receipt on retry', async () => {
    mockLookup.mockResolvedValue({ data: { id: EVENT_ID, lab_result_id: LAB_ID, patient_id: PATIENT_ID, status: 'recorded' }, error: null });
    expect((await retryLabAlerts({ patientId: PATIENT_ID, labResultId: LAB_ID })).success).toBe(true);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('keeps a retry pending when the processor throws, without automatic retry', async () => {
    mockAdminRpc.mockRejectedValue(new Error('private worker failure'));
    const result = await retryLabAlerts({ patientId: PATIENT_ID, labResultId: LAB_ID });
    expect(result).toMatchObject({ status: 'saved_alert_pending', labResultId: LAB_ID, eventId: EVENT_ID });
    expect(mockAdminRpc).toHaveBeenCalledTimes(1);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
