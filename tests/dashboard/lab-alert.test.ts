/**
 * Lab Alert Tests -- SAFE-04: Real-time lab alert insertion and dedup
 *
 * Tests saveLabResult Server Action from lib/dashboard/actions.ts:
 * - K+ > 5.5 triggers hyperkalemia alert via admin client
 * - eGFR < 15 triggers low_egfr alert via admin client
 * - Normal values -> no alert inserted
 * - Deduplication suppresses duplicate alerts
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

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

// Regular client (for lab_results insert via RLS)
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

// Admin client (for alert insert bypassing RLS)
const mockAdminFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockAdminFrom(...args),
  },
}));

// Mock alert-engine dedup (returns false = no duplicate by default)
vi.mock('@/lib/dashboard/alert-engine', () => ({
  shouldDeduplicate: vi.fn().mockReturnValue(false),
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
import { shouldDeduplicate } from '@/lib/dashboard/alert-engine';

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

    // Default: authenticated user
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
    });

    // Default: lab insert succeeds
    mockFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    // Default: no existing alerts (dedup check returns empty), alert insert succeeds
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    });

    // Default: no dedup
    vi.mocked(shouldDeduplicate).mockReturnValue(false);
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
    // Verify alert insert was called via admin client
    expect(mockAdminFrom).toHaveBeenCalledWith('alerts');
  });

  it('inserts low_egfr alert when eGFR = 10 (< 15)', async () => {
    const fd = makeFormData({
      patientId: PATIENT_ID,
      egfr: '10',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    expect(mockAdminFrom).toHaveBeenCalledWith('alerts');
  });

  it('does not insert alert for normal values (K+ = 5.0, eGFR = 40)', async () => {
    // Track alert inserts
    const alertInsertMock = vi.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          insert: alertInsertMock,
        };
      }
      return {};
    });

    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '5.0',
      egfr: '40',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    // Alert insert should NOT have been called for normal values
    expect(alertInsertMock).not.toHaveBeenCalled();
  });

  it('suppresses duplicate alert when shouldDeduplicate returns true', async () => {
    // Mock dedup to return true (existing alert found)
    vi.mocked(shouldDeduplicate).mockReturnValue(true);

    const alertInsertMock = vi.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    flags: ['hyperkalemia'],
                    status: 'open',
                    created_at: new Date().toISOString(),
                  },
                ],
                error: null,
              }),
            }),
          }),
          insert: alertInsertMock,
        };
      }
      return {};
    });

    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.5',
    });

    const result = await saveLabResult(null, fd);

    expect(result.success).toBe(true);
    // Dedup should suppress: no alert insert
    expect(alertInsertMock).not.toHaveBeenCalled();
  });

  it('returns error when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    const fd = makeFormData({
      patientId: PATIENT_ID,
      potassium: '6.0',
    });

    const result = await saveLabResult(null, fd);

    expect(result.error).toBe('Not authenticated');
  });
});
