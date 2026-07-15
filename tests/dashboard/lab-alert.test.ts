/**
 * Lab Alert Tests -- SAFE-04: Real-time lab alert insertion and dedup
 *
 * Tests saveLabResult Server Action from lib/dashboard/actions.ts:
 * - K+ > 5.5 coalesces a hyperkalemia alert via a server-only RPC
 * - eGFR < 15 coalesces a low_egfr alert via a server-only RPC
 * - Normal values -> no alert inserted
 * - Repeated signals use the same persistent coalescence path
 * - Unauthenticated -> returns error
 *
 * Note: saveLabResult already existed in actions.ts (implemented in a prior phase).
 * These tests verify the SAFE-04 behavior is correctly implemented.
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
import { saveLabResult } from '@/lib/dashboard/actions';

// ---------- Helpers ----------

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

const PATIENT_ID = '00000000-0000-4000-a000-000000000001';
const USER_ID = '00000000-0000-4000-a000-000000000099';

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
      },
    });

    // Default: lab insert succeeds
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    mockAdminRpc.mockResolvedValue({
      data: [{ alert_id: 'alert-1', created: true }],
      error: null,
    });
  });

  it('inserts hyperkalemia alert when K+ = 6.2', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.2',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    // Verify lab_results insert was called
    expect(mockFrom).toHaveBeenCalledWith('lab_results');
    expect(mockAdminRpc).toHaveBeenCalledWith('coalesce_patient_alert',
      expect.objectContaining({
        p_patient_id: PATIENT_ID,
        p_flags: ['hyperkalemia'],
      }));
  });

  it('inserts low_egfr alert when eGFR = 10 (< 15)', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      egfr: '10',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockAdminRpc).toHaveBeenCalledWith('coalesce_patient_alert',
      expect.objectContaining({ p_flags: ['low_egfr'] }));
  });

  it('does not insert alert for normal values (K+ = 5.0, eGFR = 40)', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '5.0',
      egfr: '40',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockAdminRpc).not.toHaveBeenCalled();
  });

  it('routes repeated signals through persistent coalescence', async () => {
    mockAdminRpc.mockResolvedValue({
      data: [{ alert_id: 'existing-alert', created: false }],
      error: null,
    });

    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.5',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockAdminRpc).toHaveBeenCalledTimes(1);
    expect(mockAdminRpc).toHaveBeenCalledWith('coalesce_patient_alert',
      expect.objectContaining({ p_flags: ['hyperkalemia'] }));
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
  });
});
