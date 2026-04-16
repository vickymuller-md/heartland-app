/**
 * Test helpers for Supabase integration tests.
 * Placeholder implementations -- will be filled in when Plans 01-01/01-02
 * establish the Supabase local environment.
 */

export function createTestClient() {
  throw new Error('Not implemented -- configure Supabase local test instance');
}

export function createTestUserWithRole(role: 'provider' | 'patient') {
  throw new Error(
    `Not implemented -- cannot create test user with role "${role}" without Supabase local instance`
  );
}
