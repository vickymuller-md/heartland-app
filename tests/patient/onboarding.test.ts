/**
 * markOnboardingSeen Server Action -- Tests
 * Requirement: PTUX-01
 * Source: HEARTLAND Protocol v3.3 -- Phase 25 Patient Onboarding UX
 *
 * PTUX-01: First-use onboarding persists via profiles.onboarding_seen_at
 * - markOnboardingSeen() sets onboarding_seen_at for the authenticated user
 * - markOnboardingSeen() is a no-op when user is not authenticated
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@/lib/auth/authorization', () => ({
  authorize: mockAuthorize,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

import { markOnboardingSeen } from '@/lib/patient/onboarding-actions';

describe('markOnboardingSeen (PTUX-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets onboarding_seen_at for the authenticated user', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'patient-1' } },
      error: null,
    });

    const mockEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    mockAuthorize.mockResolvedValue({
      authorized: true,
      user: { id: 'patient-1' },
      role: 'patient',
      supabase: { from: mockFrom },
    });

    await markOnboardingSeen();

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onboarding_seen_at: expect.any(String) })
    );
    expect(mockEq).toHaveBeenCalledWith('id', 'patient-1');
  });

  it('returns without error when user is not authenticated (no-op)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'Not authenticated' });

    // Should not throw
    await expect(markOnboardingSeen()).resolves.toBeUndefined();
    // Should NOT call from() since user is null
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
