import { describe, it, expect } from 'vitest';

describe('Linkage RLS Policies', () => {
  // INTEGRATION: requires Supabase local
  it('should allow provider to read their own links', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should deny provider from reading other providers links', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should allow patient to read their own links', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should deny patient from reading other patients links', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should allow patient to insert a pending linkage request', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should allow provider to update link status', () => {
    // TODO: implement
    expect(true).toBe(false);
  });

  // INTEGRATION: requires Supabase local
  it('should deny patient from updating link status', () => {
    // TODO: implement
    expect(true).toBe(false);
  });
});
