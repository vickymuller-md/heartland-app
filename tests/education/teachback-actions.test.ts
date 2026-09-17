/**
 * Professional teach-back -- server action (migration 00040).
 *
 * Contract: dissemination/ecosystem_update/O4_DESENHO_00040_RESPONSABILIDADE_TEACHBACK
 * section 2 (a teach-back is a professional record, separate from the patient
 * self-assessment; `deferred` and `not_applicable` need a documented reason; the
 * `educate` authorization is enforced by the database and surfaced as 42501).
 * Supabase is mocked: these tests pin the RPC name, its parameter names and the
 * error mapping. All ids are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const mockAuthorize = vi.fn();
vi.mock('@/lib/auth/authorization', () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
  authorizeProviderForPatient: vi.fn(),
}));

import { recordTeachBack } from '@/lib/education/teachback-actions';

const PATIENT_ID = '00000000-0000-4000-a000-000000000001';
const ACTOR_ID = '00000000-0000-4000-a000-000000000002';

const mockRpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({
    authorized: true,
    user: { id: ACTOR_ID },
    role: 'provider',
    supabase: { rpc: mockRpc },
  });
  mockRpc.mockResolvedValue({ data: 'teachback-id', error: null });
});

describe('recordTeachBack', () => {
  it('records a verified teach-back through record_education_teachback', async () => {
    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'daily_weight',
      outcome: 'verified',
      method: 'telephone',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('record_education_teachback', {
      p_patient_id: PATIENT_ID,
      p_domain_id: 'daily_weight',
      p_outcome: 'verified',
      p_reason: null,
      p_method: 'telephone',
      p_caregiver_present: null,
    });
  });

  it('never writes education_progress: the only call is the teach-back RPC', async () => {
    await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'medications',
      outcome: 'not_verified',
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('record_education_teachback');
  });

  it('refuses a deferral without a documented reason', async () => {
    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'warning_signs',
      outcome: 'deferred',
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toBe(
      'Deferring or marking not applicable requires a documented reason',
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuses a not-applicable whose reason is shorter than three characters', async () => {
    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'warning_signs',
      outcome: 'not_applicable',
      reason: ' x ',
    });

    expect(result.error).toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends the documented reason when one is supplied', async () => {
    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'sodium_restriction',
      outcome: 'deferred',
      reason: 'Patient too dyspneic to complete the session today',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_outcome: 'deferred',
      p_reason: 'Patient too dyspneic to complete the session today',
    });
  });

  it('maps 42501 to the missing education authorization', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Recording education requires the educate authorization' },
    });

    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'daily_weight',
      outcome: 'verified',
    });

    expect(result.error).toBe(
      "You do not hold the education authorization for this patient's organization.",
    );
  });

  it('maps 22023 to the documented-reason requirement', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'Deferred or not-applicable requires a documented reason' },
    });

    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'daily_weight',
      outcome: 'verified',
    });

    expect(result.error).toBe('This teach-back was refused: a documented reason is required.');
  });

  it('rejects a domain that is not in the offered set', async () => {
    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'not_a_domain',
      outcome: 'verified',
    });

    expect(result.error).toBe('Unknown education domain');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuses a caller without provider authorization', async () => {
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'MFA required' });

    const result = await recordTeachBack({
      patientId: PATIENT_ID,
      domainId: 'daily_weight',
      outcome: 'verified',
    });

    expect(result).toEqual({ error: 'MFA required' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
