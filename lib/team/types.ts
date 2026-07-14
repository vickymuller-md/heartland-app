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
