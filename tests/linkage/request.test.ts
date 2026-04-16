import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they're available inside vi.mock factories
const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

// Chain builder helper: creates a chainable Supabase query mock
function chainQuery(resolvedValue: { data: unknown; error: unknown }) {
  const terminal = {
    maybeSingle: vi.fn().mockResolvedValue(resolvedValue),
    single: vi.fn().mockResolvedValue(resolvedValue),
  };
  const deepEq = vi.fn().mockReturnValue(terminal);
  const eqFn = vi.fn().mockReturnValue({ ...terminal, eq: deepEq });
  return {
    select: vi.fn().mockReturnValue({ eq: eqFn, ...terminal }),
    insert: vi.fn().mockResolvedValue(resolvedValue),
    eq: eqFn,
    ...terminal,
  };
}

import { requestLinkage } from '@/lib/actions/linkage';

describe('Patient Linkage Request (AUTH-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('requestLinkage Server Action', () => {
    it('should reject if caller is not authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const formData = new FormData();
      formData.set('provider_code', 'ABC234');

      const result = await requestLinkage(formData);
      expect(result).toEqual({ error: 'Not authenticated' });
    });

    it('should normalize provider code to uppercase and trim whitespace', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      const providerChain = chainQuery({ data: { id: 'prov-1', full_name: 'Dr. Test' }, error: null });
      const linkCheckChain = chainQuery({ data: null, error: null });
      const insertChain = chainQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return providerChain;
        if (callCount === 2) return linkCheckChain;
        return insertChain;
      });

      const formData = new FormData();
      formData.set('provider_code', '  abc234  ');

      const result = await requestLinkage(formData);
      expect(providerChain.select).toHaveBeenCalled();
      expect(result).toEqual({ success: true, provider_name: 'Dr. Test' });
    });

    it('should return error for invalid provider code format', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      // Contains excluded chars: 0, O, I
      const formData = new FormData();
      formData.set('provider_code', '00OOII');

      const result = await requestLinkage(formData);
      expect(result).toEqual({ error: 'Invalid code format' });
    });

    it('should return error if already actively linked to this provider', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      const providerChain = chainQuery({ data: { id: 'prov-1', full_name: 'Dr. Test' }, error: null });
      const linkCheckChain = chainQuery({ data: { id: 'link-1', status: 'active' }, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return providerChain;
        return linkCheckChain;
      });

      const formData = new FormData();
      formData.set('provider_code', 'ABC234');

      const result = await requestLinkage(formData);
      expect(result).toEqual({ error: 'You are already linked to this provider' });
    });

    it('should return error if a pending request already exists', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      const providerChain = chainQuery({ data: { id: 'prov-1', full_name: 'Dr. Test' }, error: null });
      const linkCheckChain = chainQuery({ data: { id: 'link-1', status: 'pending' }, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return providerChain;
        return linkCheckChain;
      });

      const formData = new FormData();
      formData.set('provider_code', 'ABC234');

      const result = await requestLinkage(formData);
      expect(result).toEqual({ error: 'A linkage request is already pending with this provider' });
    });

    it('should create provider_patient_links row with status=pending', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      const providerChain = chainQuery({ data: { id: 'prov-1', full_name: 'Dr. Test' }, error: null });
      const linkCheckChain = chainQuery({ data: null, error: null });
      const insertChain = chainQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return providerChain;
        if (callCount === 2) return linkCheckChain;
        return insertChain;
      });

      const formData = new FormData();
      formData.set('provider_code', 'ABC234');

      const result = await requestLinkage(formData);
      expect(result).toHaveProperty('success', true);
      expect(insertChain.insert).toHaveBeenCalledWith({
        provider_id: 'prov-1',
        patient_id: 'patient-1',
        status: 'pending',
      });
    });

    it('should return provider name on success', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'patient-1' } }, error: null });

      const providerChain = chainQuery({ data: { id: 'prov-1', full_name: 'Dr. Smith' }, error: null });
      const linkCheckChain = chainQuery({ data: null, error: null });
      const insertChain = chainQuery({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return providerChain;
        if (callCount === 2) return linkCheckChain;
        return insertChain;
      });

      const formData = new FormData();
      formData.set('provider_code', 'ABC234');

      const result = await requestLinkage(formData);
      expect(result).toEqual({ success: true, provider_name: 'Dr. Smith' });
    });
  });
});
