import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccessReview,
  DeliveryHealth,
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
