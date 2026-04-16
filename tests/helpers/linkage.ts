/**
 * Test helpers for Phase 2 Provider-Patient Linkage tests.
 * Factory functions for creating mock providers, patients, links,
 * and Supabase client mocks with chainable query patterns.
 */

import { vi } from 'vitest';

/**
 * Creates a mock provider profile object.
 */
export function createTestProvider(overrides?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    role: 'provider' as const,
    full_name: 'Dr. Test Provider',
    email: 'provider@example.com',
    provider_code: 'ABC234',
    ...overrides,
  };
}

/**
 * Creates a mock patient profile object.
 */
export function createTestPatient(overrides?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    role: 'patient' as const,
    full_name: 'Test Patient',
    email: 'patient@example.com',
    ...overrides,
  };
}

/**
 * Creates a mock provider_patient_links row.
 */
export function createTestLink(overrides?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    provider_id: crypto.randomUUID(),
    patient_id: crypto.randomUUID(),
    status: 'pending' as const,
    created_at: new Date().toISOString(),
    linked_at: null,
    invite_email: null,
    ...overrides,
  };
}

/**
 * Returns a minimal mock of the Supabase client with chainable
 * .from().select().eq().single() pattern. All methods use vi.fn().
 */
export function mockSupabaseClient() {
  const single = vi.fn().mockResolvedValue({ data: null, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn().mockReturnValue({ single, maybeSingle, eq: vi.fn().mockReturnValue({ single, maybeSingle }) });
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const select = vi.fn().mockReturnValue({ eq, single, maybeSingle });
  const from = vi.fn().mockReturnValue({ select, insert, update });

  return {
    from,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  };
}

/**
 * Returns a mock of the Supabase admin client with
 * auth.admin.inviteUserByEmail mocked.
 */
export function mockSupabaseAdmin() {
  return {
    from: mockSupabaseClient().from,
    auth: {
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  };
}
