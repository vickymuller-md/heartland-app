/**
 * Member capabilities (migration 00040).
 *
 * Contract: capabilities are read from `member_authorizations` joined to the
 * membership in JavaScript (no PostgREST embed on `profiles`, so PGRST201
 * cannot occur), and both writes go through the manager-only RPCs. Evidence is
 * required for `change_medication` and `clinical_disposition`. All ids are
 * synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: vi.fn() }));

const mockAuthorize = vi.fn();
vi.mock('@/lib/auth/authorization', () => ({
  authorize: (...args: unknown[]) => mockAuthorize(...args),
  authorizeProviderForPatient: vi.fn(),
}));

import { grantMemberCapability, revokeMemberCapability } from '@/lib/team/actions';
import { getMemberCapabilities, memberHasCapability } from '@/lib/team/queries';

const ORGANIZATION_ID = '00000000-0000-4000-a000-000000000001';
const MEMBERSHIP_ID = '00000000-0000-4000-a000-000000000002';
const MEMBER_ID = '00000000-0000-4000-a000-000000000003';
const AUTHORIZATION_ID = '00000000-0000-4000-a000-000000000004';
const ACTOR_ID = '00000000-0000-4000-a000-000000000005';

const mockRpc = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorize.mockResolvedValue({
    authorized: true,
    user: { id: ACTOR_ID },
    role: 'provider',
    supabase: { rpc: mockRpc },
  });
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe('grantMemberCapability', () => {
  it('grants educate without credential evidence', async () => {
    const result = await grantMemberCapability({
      membershipId: MEMBERSHIP_ID,
      capability: 'educate',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('grant_member_capability', {
      p_membership_id: MEMBERSHIP_ID,
      p_capability: 'educate',
      p_evidence_ref: null,
    });
  });

  it('refuses change_medication without recorded credential evidence', async () => {
    const result = await grantMemberCapability({
      membershipId: MEMBERSHIP_ID,
      capability: 'change_medication',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('This capability requires recorded credential evidence');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends the evidence reference for clinical_disposition', async () => {
    const result = await grantMemberCapability({
      membershipId: MEMBERSHIP_ID,
      capability: 'clinical_disposition',
      evidenceRef: 'NP licence NM-44812 verified 2026-09-01',
    });

    expect(result).toEqual({ success: true });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_capability: 'clinical_disposition',
      p_evidence_ref: 'NP licence NM-44812 verified 2026-09-01',
    });
  });

  it('rejects a capability outside the six the database accepts', async () => {
    const result = await grantMemberCapability({
      membershipId: MEMBERSHIP_ID,
      capability: 'prescribe' as 'educate',
    });

    expect(result.success).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps 42501 to the manager-only rule', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Capability grant not authorized' },
    });

    const result = await grantMemberCapability({
      membershipId: MEMBERSHIP_ID,
      capability: 'educate',
    });

    expect(result.error).toBe('Only a team manager can change authorizations.');
  });
});

describe('revokeMemberCapability', () => {
  it('revokes one grant by id', async () => {
    const result = await revokeMemberCapability({ authorizationId: AUTHORIZATION_ID });

    expect(result).toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith('revoke_member_capability', {
      p_authorization_id: AUTHORIZATION_ID,
    });
  });

  it('reports a refused revocation', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Capability revocation not authorized' },
    });

    const result = await revokeMemberCapability({ authorizationId: AUTHORIZATION_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Only a team manager can change authorizations.');
  });

  it('refuses an unauthenticated caller', async () => {
    mockAuthorize.mockResolvedValue({ authorized: false, error: 'MFA required' });

    const result = await revokeMemberCapability({ authorizationId: AUTHORIZATION_ID });

    expect(result).toEqual({ success: false, error: 'MFA required' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('memberHasCapability', () => {
  it('treats 42501 as "no capability" instead of a screen error', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'not authorized' } });

    await expect(
      memberHasCapability({ rpc } as never, 'educate', ORGANIZATION_ID),
    ).resolves.toBe(false);
  });

  it('returns the boolean the RPC gives', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      memberHasCapability({ rpc } as never, 'educate', ORGANIZATION_ID),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('member_has_capability', {
      p_capability: 'educate',
      p_organization_id: ORGANIZATION_ID,
    });
  });
});

describe('getMemberCapabilities', () => {
  const selects: string[] = [];

  function stub(authorizations: Array<Record<string, unknown>>) {
    selects.length = 0;
    return {
      rpc: vi.fn(async (name: string) =>
        name === 'get_my_team_members'
          ? {
              data: [
                {
                  organization_id: ORGANIZATION_ID,
                  organization_name: 'Rural Health Clinic',
                  member_id: MEMBER_ID,
                  member_name: 'Dana Reyes, RN',
                  member_role: 'clinician',
                  is_default: true,
                  is_self: false,
                },
                {
                  organization_id: ORGANIZATION_ID,
                  organization_name: 'Rural Health Clinic',
                  member_id: ACTOR_ID,
                  member_name: 'Avery Cole, MD',
                  member_role: 'owner',
                  is_default: true,
                  is_self: true,
                },
              ],
              error: null,
            }
          : { data: null, error: null },
      ),
      from: (table: string) => ({
        select: (columns: string) => {
          selects.push(columns);
          return {
            eq: async () => ({
              data: [
                { id: MEMBERSHIP_ID, organization_id: ORGANIZATION_ID, user_id: MEMBER_ID },
              ],
              error: null,
            }),
            is: async () => ({ data: authorizations, error: null }),
          };
        },
        table,
      }),
    } as never;
  }

  it('joins authorizations to the member without embedding profiles', async () => {
    const result = await getMemberCapabilities(
      stub([
        {
          id: AUTHORIZATION_ID,
          membership_id: MEMBERSHIP_ID,
          capability: 'educate',
          granted_at: '2026-09-17T00:00:00Z',
          expires_at: null,
          grant_source: 'bootstrap_00040',
        },
      ]),
    );

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      membership_id: MEMBERSHIP_ID,
      member_name: 'Dana Reyes, RN',
      can_manage: true,
    });
    expect(result.rows[0].authorizations).toEqual([
      {
        id: AUTHORIZATION_ID,
        capability: 'educate',
        granted_at: '2026-09-17T00:00:00Z',
        expires_at: null,
        grant_source: 'bootstrap_00040',
      },
    ]);
    expect(selects.some((columns) => columns.includes('profiles'))).toBe(false);
  });

  it('drops a grant whose expiry has already passed', async () => {
    const result = await getMemberCapabilities(
      stub([
        {
          id: AUTHORIZATION_ID,
          membership_id: MEMBERSHIP_ID,
          capability: 'monitor',
          granted_at: '2026-01-01T00:00:00Z',
          expires_at: '2026-01-02T00:00:00Z',
          grant_source: 'manager_grant',
        },
      ]),
    );

    expect(result.rows[0].authorizations).toEqual([]);
  });
});
