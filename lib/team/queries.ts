import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccessReview,
  DeliveryHealth,
  MemberAuthorization,
  MemberCapability,
  MemberCapabilityRow,
  OrganizationSettings,
  TeamMember,
  TeamOperationsResult,
  TeamWorkload,
} from './types';

function numericCounts<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key.endsWith('_count') && value !== null ? Number(value) : value,
    ]),
  ) as T;
}

export async function getTeamOperations(
  supabase: SupabaseClient,
): Promise<TeamOperationsResult> {
  const [members, workload, organizations, reviews, delivery] = await Promise.all([
    supabase.rpc('get_my_team_members'),
    supabase.rpc('get_team_workload'),
    supabase
      .from('organizations')
      .select('id, name, timezone, alert_sla_minutes, downtime_contact')
      .order('name'),
    supabase
      .from('access_reviews')
      .select(
        'id, organization_id, review_period, reviewer_id, active_members_count, active_patient_count, open_work_items_count, findings, completed_at',
      )
      .order('completed_at', { ascending: false })
      .limit(12),
    supabase.rpc('get_team_delivery_health'),
  ]);

  if (
    members.error || workload.error || organizations.error || reviews.error || delivery.error
  ) {
    return {
      members: [],
      workloads: [],
      organizations: [],
      accessReviews: [],
      deliveryHealth: [],
      canManage: false,
      manageableOrganizationIds: [],
      error: 'Team operations could not be loaded. Do not use this page for access decisions until it recovers.',
    };
  }

  const typedMembers = (members.data ?? []) as TeamMember[];
  const manageableOrganizationIds = typedMembers
    .filter(
      (member) => member.is_self && (member.member_role === 'owner' || member.member_role === 'admin'),
    )
    .map((member) => member.organization_id);
  return {
    members: typedMembers,
    workloads: ((workload.data ?? []) as Array<Record<string, unknown>>).map(
      (row) => numericCounts(row) as unknown as TeamWorkload,
    ),
    organizations: (organizations.data ?? []) as OrganizationSettings[],
    accessReviews: (reviews.data ?? []) as AccessReview[],
    deliveryHealth: ((delivery.data ?? []) as Array<Record<string, unknown>>).map(
      (row) => numericCounts(row) as unknown as DeliveryHealth,
    ),
    canManage: manageableOrganizationIds.length > 0,
    manageableOrganizationIds,
    error: null,
  };
}

export async function getTeamDirectory(
  supabase: SupabaseClient,
): Promise<{ members: TeamMember[]; manageableOrganizationIds: string[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_my_team_members');
  if (error) return { members: [], manageableOrganizationIds: [], error: 'Team directory unavailable.' };
  const members = (data ?? []) as TeamMember[];
  return {
    members,
    manageableOrganizationIds: members
      .filter(
        (member) => member.is_self && (member.member_role === 'owner' || member.member_role === 'admin'),
      )
      .map((member) => member.organization_id),
    error: null,
  };
}

/**
 * Whether the caller holds one capability in one organization (migration 00040).
 *
 * `member_has_capability` raises 42501 when the caller is not an active AAL2
 * member of that organization. That is "no capability" for the screen, never an
 * error to surface.
 */
export async function memberHasCapability(
  supabase: SupabaseClient,
  capability: MemberCapability,
  organizationId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('member_has_capability', {
    p_capability: capability,
    p_organization_id: organizationId,
  });
  if (error) return false;
  return data === true;
}

export async function hasCapabilityInAnyOrganization(
  supabase: SupabaseClient,
  capability: MemberCapability,
  organizationIds: string[],
): Promise<boolean> {
  if (organizationIds.length === 0) return false;
  const results = await Promise.all(
    organizationIds.map((organizationId) =>
      memberHasCapability(supabase, capability, organizationId),
    ),
  );
  return results.some(Boolean);
}

/**
 * Active capabilities per team member (migration 00040).
 *
 * Memberships and authorizations are read as two flat selects and joined in
 * JavaScript: no PostgREST embed touches `profiles`, so no FK hint is needed
 * and PGRST201 cannot occur. Names come from `get_my_team_members`.
 */
export async function getMemberCapabilities(
  supabase: SupabaseClient,
): Promise<{ rows: MemberCapabilityRow[]; error: string | null }> {
  const directory = await getTeamDirectory(supabase);
  if (directory.error) return { rows: [], error: 'Member authorizations unavailable.' };

  const [memberships, authorizations] = await Promise.all([
    supabase
      .from('organization_memberships')
      .select('id, organization_id, user_id')
      .eq('status', 'active'),
    supabase
      .from('member_authorizations')
      .select('id, membership_id, capability, granted_at, expires_at, grant_source')
      .is('revoked_at', null),
  ]);

  if (memberships.error || authorizations.error) {
    return { rows: [], error: 'Member authorizations unavailable.' };
  }

  const now = Date.now();
  const byMembership = new Map<string, MemberAuthorization[]>();
  for (const row of (authorizations.data ?? []) as Array<
    MemberAuthorization & { membership_id: string }
  >) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;
    const list = byMembership.get(row.membership_id) ?? [];
    list.push({
      id: row.id,
      capability: row.capability,
      granted_at: row.granted_at,
      expires_at: row.expires_at,
      grant_source: row.grant_source,
    });
    byMembership.set(row.membership_id, list);
  }

  const membershipIds = new Map<string, string>();
  for (const row of (memberships.data ?? []) as Array<{
    id: string;
    organization_id: string;
    user_id: string;
  }>) {
    membershipIds.set(`${row.organization_id}:${row.user_id}`, row.id);
  }

  const rows = directory.members.flatMap((member) => {
    const membershipId = membershipIds.get(
      `${member.organization_id}:${member.member_id}`,
    );
    if (!membershipId) return [];
    return [
      {
        membership_id: membershipId,
        organization_id: member.organization_id,
        organization_name: member.organization_name,
        member_id: member.member_id,
        member_name: member.member_name,
        member_role: member.member_role,
        can_manage: directory.manageableOrganizationIds.includes(member.organization_id),
        authorizations: byMembership.get(membershipId) ?? [],
      },
    ];
  });

  return { rows, error: null };
}
