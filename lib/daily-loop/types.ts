export type WorkPriority = 'now' | 'today' | 'week' | 'watching';
export type WorkSeverity = 'critical' | 'warning' | 'informational';
export type WorkStatus = 'new' | 'reviewed' | 'actioned' | 'awaiting' | 'due' | 'closed';
export type DataQuality = 'verified' | 'partial' | 'stale' | 'unknown';

/** Accountability model that produced the current accountable provider. */
export type AccountabilitySource =
  | 'designated'
  | 'coverage'
  | 'sole_member'
  | 'org_owner'
  | 'accepted_transfer'
  | 'manager_reassigned'
  | 'legacy_fan_out';

/** Documented closure outcomes. `followup_*` and `outcome_not_recorded` are database-written only. */
export type OutcomeCode =
  | 'clinical_action_taken'
  | 'no_action_needed'
  | 'patient_unreachable'
  | 'care_not_delivered'
  | 'transferred_to_other_team'
  | 'duplicate_or_superseded'
  | 'administrative_close'
  | 'followup_completed'
  | 'followup_skipped'
  | 'outcome_not_recorded';

/** Outcome codes a provider may choose in the app. */
export const PROVIDER_OUTCOME_CODES = [
  'clinical_action_taken',
  'no_action_needed',
  'patient_unreachable',
  'care_not_delivered',
  'transferred_to_other_team',
  'duplicate_or_superseded',
] as const;

/** Outcome code reserved for team managers. */
export const MANAGER_OUTCOME_CODE = 'administrative_close' as const;

export const OUTCOME_CODE_LABELS: Record<
  typeof PROVIDER_OUTCOME_CODES[number] | typeof MANAGER_OUTCOME_CODE,
  string
> = {
  clinical_action_taken: 'Clinical action taken',
  no_action_needed: 'Assessed — no action needed',
  patient_unreachable: 'Patient unreachable',
  care_not_delivered: 'Indicated care not delivered',
  transferred_to_other_team: 'Transferred to another team',
  duplicate_or_superseded: 'Duplicate or superseded',
  administrative_close: 'Administrative close (not a clinical decision)',
};

export interface WorkItem {
  id: string;
  organization_id: string;
  patient_id: string;
  patient_name: string;
  provider_id: string;
  assigned_to: string;
  owner_name: string;
  source_type: string;
  source_id: string | null;
  title: string;
  reason: string;
  change_summary: string | null;
  priority: WorkPriority;
  severity: WorkSeverity;
  status: WorkStatus;
  due_at: string | null;
  freshness_at: string | null;
  data_quality: DataQuality;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  transfer_pending_to: string | null;
  transfer_offered_at: string | null;
  transfer_offered_by: string | null;
  transfer_recipient_name: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  accountability_source: AccountabilitySource | null;
  underlying_alert_resolved_at: string | null;
  outcome_code: OutcomeCode | null;
}

/** A transfer offered to the current provider. The item is still owned by someone else. */
export interface PendingTransfer {
  id: string;
  organization_id: string;
  patient_id: string;
  patient_name: string;
  title: string;
  reason: string;
  severity: WorkSeverity;
  status: WorkStatus;
  due_at: string | null;
  transfer_offered_at: string | null;
  offered_by_name: string | null;
}

export interface SavedQueueView {
  id: string;
  name: string;
  severity: WorkSeverity | null;
  priority: WorkPriority | null;
  source_type: string | null;
}

export interface DailyLoopFilter {
  severity?: WorkSeverity;
  priority?: WorkPriority;
  sourceType?: string;
}

export interface DailyLoopSections {
  now: WorkItem[];
  today: WorkItem[];
  week: WorkItem[];
  watching: WorkItem[];
}

export interface DailyLoopMetrics {
  open: number;
  overdue: number;
  dueToday: number;
  closedLast7Days: number;
  completionRate7Days: number | null;
  /** Assigned to this provider and not accepted yet. */
  unaccepted: number;
  /** Still open with the underlying alert already resolved — a documented outcome is required. */
  awaitingOutcome: number;
  /** Transfers offered to this provider and awaiting a response. */
  pendingTransfers: number;
}

export interface DailyLoopResult {
  sections: DailyLoopSections;
  metrics: DailyLoopMetrics;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  timeZone: string;
  error: string | null;
}

export interface DailyLoopPaginationInput {
  limit?: number;
  offset?: number;
}
