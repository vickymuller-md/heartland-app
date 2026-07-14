/**
 * Provider Notes -- Validation Tests
 * Requirements: DASH-09 (provider notes CRUD and display)
 * Source: HEARTLAND Protocol v3.3
 *
 * Tests the validation logic of the addProviderNote server action.
 * Supabase calls are mocked -- these test input validation only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock next/cache (revalidatePath)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
}));
const mockAuthorizeProviderForPatient = vi.fn();

vi.mock('@/lib/auth/authorization', () => ({
  authorize: vi.fn(),
  authorizeProviderForPatient: (...args: unknown[]) =>
    mockAuthorizeProviderForPatient(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: vi.fn() },
}));

import { addProviderNote } from '@/lib/dashboard/actions';

// ==========================================================================
// DASH-09: Provider notes -- insert, validate, display
// ==========================================================================

describe('addProviderNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizeProviderForPatient.mockResolvedValue({
      authorized: true,
      user: { id: 'provider-123' },
      role: 'provider',
      supabase: { from: mockFrom },
    });
    mockInsert.mockResolvedValue({ error: null });
  });

  it('rejects empty content', async () => {
    const formData = new FormData();
    formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000');
    formData.set('content', '');

    const result = await addProviderNote(undefined, formData);
    expect(result.errors).toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects content over 5000 characters', async () => {
    const formData = new FormData();
    formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000');
    formData.set('content', 'x'.repeat(5001));

    const result = await addProviderNote(undefined, formData);
    expect(result.errors).toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects invalid UUID for patientId', async () => {
    const formData = new FormData();
    formData.set('patientId', 'not-a-uuid');
    formData.set('content', 'Valid note content');

    const result = await addProviderNote(undefined, formData);
    expect(result.errors).toBeDefined();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns error when user is not authenticated', async () => {
    mockAuthorizeProviderForPatient.mockResolvedValue({
      authorized: false,
      error: 'Not authenticated',
    });

    const formData = new FormData();
    formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000');
    formData.set('content', 'A valid note');

    const result = await addProviderNote(undefined, formData);
    expect(result.error).toBeDefined();
  });

  it('accepts valid note and calls insert', async () => {
    const formData = new FormData();
    formData.set('patientId', '550e8400-e29b-41d4-a716-446655440000');
    formData.set('content', 'Patient reports improvement in breathing');

    const result = await addProviderNote(undefined, formData);
    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalled();
  });
});
