import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions
const { mockGetUser, mockFrom, mockRevalidatePath } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

// Chain builder: Supabase .from().update().eq().eq().eq()
// Tracks all eq calls and resolves with the given value when awaited
function chainUpdate(resolvedValue: { error: unknown; count?: number }) {
  const eqCalls: Array<[string, unknown]> = [];

  function makeLink(): Record<string, unknown> {
    const promise = Promise.resolve(resolvedValue);
    return {
      eq: vi.fn().mockImplementation((col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return makeLink();
      }),
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
    };
  }

  const root = makeLink();
  const update = vi.fn().mockReturnValue(root);
  return { update, eqCalls };
}

import { acceptLinkage, rejectLinkage } from '@/lib/actions/linkage';

describe('Provider Linkage Management (AUTH-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('acceptLinkage', () => {
    it('should reject if caller is not authenticated', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const result = await acceptLinkage('link-123');
      expect(result).toEqual({ error: 'Not authenticated' });
    });

    it('should update link status from pending to active', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      const result = await acceptLinkage('link-123');
      expect(result).toEqual({ success: true });
      expect(chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          linked_at: expect.any(String),
        })
      );
    });

    it('should set linked_at timestamp on acceptance', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await acceptLinkage('link-123');
      const updateArg = chain.update.mock.calls[0][0];
      // linked_at should be a valid ISO date string
      expect(new Date(updateArg.linked_at).toISOString()).toBe(updateArg.linked_at);
    });

    it('should only allow the linked provider to accept (not other providers)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await acceptLinkage('link-123');
      // The eq chain should include provider_id = user.id
      expect(chain.eqCalls).toContainEqual(['provider_id', 'provider-1']);
    });

    it('should not accept already active or rejected links', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await acceptLinkage('link-123');
      // Should filter by status = 'pending'
      expect(chain.eqCalls).toContainEqual(['status', 'pending']);
    });

    it('should revalidate /patients/manage on success', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await acceptLinkage('link-123');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/patients/manage');
    });
  });

  describe('rejectLinkage', () => {
    it('should update link status from pending to rejected', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      const result = await rejectLinkage('link-123');
      expect(result).toEqual({ success: true });
      expect(chain.update).toHaveBeenCalledWith({ status: 'rejected' });
    });

    it('should only allow the linked provider to reject', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await rejectLinkage('link-123');
      expect(chain.eqCalls).toContainEqual(['provider_id', 'provider-1']);
    });

    it('should revalidate /patients/manage on success', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } }, error: null });

      const chain = chainUpdate({ error: null });
      mockFrom.mockReturnValue(chain);

      await rejectLinkage('link-123');
      expect(mockRevalidatePath).toHaveBeenCalledWith('/patients/manage');
    });
  });
});
