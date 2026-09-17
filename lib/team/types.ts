export interface TeamMember {
  organization_id: string;
  organization_name: string;
  member_id: string;
  member_name: string;
  member_role: 'owner' | 'admin' | 'clinician' | 'coordinator';
  is_default: boolean;
  is_self: boolean;
}

export interface TeamWorkload {
  organization_id: string;
  member_id: string;
  member_name: string;
  member_role: string;
  open_count: number;
  overdue_count: number;
  due_today_count: number;
  critical_count: number;
  oldest_due_at: string | null;
}

export interface OrganizationSettings {
  id: string;
  name: string;
  timezone: string;
  alert_sla_minutes: number;
  downtime_contact: string | null;
}

export interface AccessReview {
  id: string;
  organization_id: string;
  review_period: string;
  reviewer_id: string;
  active_members_count: number;
  active_patient_count: number;
  open_work_items_count: number;
  findings: string;
  completed_at: string;
}

export interface DeliveryHealth {
  organization_id: string;
  available_count: number;
  read_count: number;
  failed_count: number;
  superseded_count: number;
  oldest_available_at: string | null;
}

/**
 * Per-member clinical capabilities (migration 00040). `member_authorizations`
 * is readable by the team and carries no credential strings; the evidence that
 * backs a grant lives in a manager-only table and is never read here.
 */
export const MEMBER_CAPABILITIES = [
  'reconcile_medications',
  'educate',
  'monitor',
  'recommend',
  'change_medication',
  'clinical_disposition',
] as const;

export type MemberCapability = (typeof MEMBER_CAPABILITIES)[number];

/** Capabilities the database refuses without recorded credential evidence. */
export const EVIDENCE_REQUIRED_CAPABILITIES: readonly MemberCapability[] = [
  'change_medication',
  'clinical_disposition',
];

export const MEMBER_CAPABILITY_LABELS: Record<MemberCapability, string> = {
  reconcile_medications: 'Reconcile medications',
  educate: 'Educate',
  monitor: 'Monitor',
  recommend: 'Recommend',
  change_medication: 'Change medication',
  clinical_disposition: 'Clinical disposition',
};

export interface MemberAuthorization {
  id: string;
  capability: MemberCapability;
  granted_at: string;
  expires_at: string | null;
  grant_source: 'manager_grant' | 'bootstrap_00040';
}

export interface MemberCapabilityRow {
  membership_id: string;
  organization_id: string;
  organization_name: string;
  member_id: string;
  member_name: string;
  member_role: string;
  can_manage: boolean;
  authorizations: MemberAuthorization[];
}

export interface TeamOperationsResult {
  members: TeamMember[];
  workloads: TeamWorkload[];
  organizations: OrganizationSettings[];
  accessReviews: AccessReview[];
  deliveryHealth: DeliveryHealth[];
  canManage: boolean;
  manageableOrganizationIds: string[];
  error: string | null;
}
