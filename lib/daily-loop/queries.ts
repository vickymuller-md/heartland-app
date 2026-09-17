import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractFullName, extractPatientFullName } from '@/lib/supabase/types';
import type {
  DailyLoopFilter,
  DailyLoopMetrics,
  DailyLoopResult,
  DailyLoopSections,
  DailyLoopPaginationInput,
  PendingTransfer,
  SavedQueueView,
  WorkItem,
} from './types';
import { addZonedDays, DEFAULT_TIME_ZONE, getZonedDayBounds } from '@/lib/timezone';

const EMPTY_SECTIONS: DailyLoopSections = {
  now: [],
  today: [],
  week: [],
  watching: [],
};

const EMPTY_METRICS: DailyLoopMetrics = {
  open: 0,
  overdue: 0,
  dueToday: 0,
  closedLast7Days: 0,
  completionRate7Days: null,
  unaccepted: 0,
  awaitingOutcome: 0,
  pendingTransfers: 0,
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * Every `profiles` embed carries an explicit FK hint: `work_items` references `profiles`
 * from `assigned_to`, `accepted_by`, `transfer_pending_to` and `transfer_offered_by`, so an
 * unhinted embed is ambiguous (PGRST201).
 */
const WORK_ITEM_SELECT =
  'id, organization_id, patient_id, provider_id, assigned_to, source_type, source_id, title, reason, change_summary, priority, severity, status, due_at, freshness_at, data_quality, created_at, updated_at, accepted_at, accepted_by, transfer_pending_to, transfer_offered_at, transfer_offered_by, declined_at, declined_reason, accountability_source, underlying_alert_resolved_at, outcome_code, patients!work_items_patient_id_fkey(profiles!patients_id_fkey(full_name)), assignee:profiles!work_items_assigned_to_fkey(full_name), recipient:profiles!work_items_transfer_pending_to_fkey(full_name)';

function toWorkItem(row: Record<string, unknown>): WorkItem {
  return {
    id: row.id,
    organization_id: row.organization_id,
    patient_id: row.patient_id,
    patient_name: extractPatientFullName(row.patients) ?? 'Patient',
    provider_id: row.provider_id,
    assigned_to: row.assigned_to,
    owner_name: extractFullName(row.assignee) ?? 'You',
    source_type: row.source_type,
    source_id: row.source_id,
    title: row.title,
    reason: row.reason,
    change_summary: row.change_summary,
    priority: row.priority,
    severity: row.severity,
    status: row.status,
    due_at: row.due_at,
    freshness_at: row.freshness_at,
    data_quality: row.data_quality,
    created_at: row.created_at,
    updated_at: row.updated_at,
    accepted_at: row.accepted_at ?? null,
    accepted_by: row.accepted_by ?? null,
    transfer_pending_to: row.transfer_pending_to ?? null,
    transfer_offered_at: row.transfer_offered_at ?? null,
    transfer_offered_by: row.transfer_offered_by ?? null,
    transfer_recipient_name: extractFullName(row.recipient) ?? null,
    declined_at: row.declined_at ?? null,
    declined_reason: row.declined_reason ?? null,
    accountability_source: row.accountability_source ?? null,
    underlying_alert_resolved_at: row.underlying_alert_resolved_at ?? null,
    outcome_code: row.outcome_code ?? null,
  } as WorkItem;
}

export function groupDailyLoopItems(
  items: WorkItem[],
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): DailyLoopSections {
  const sections: DailyLoopSections = {
    now: [],
    today: [],
    week: [],
    watching: [],
  };
  const { endExclusive: endToday } = getZonedDayBounds(now, timeZone);
  const endWeek = addZonedDays(now, 7, timeZone);

  for (const item of items) {
    const due = item.due_at ? new Date(item.due_at) : null;
    if (item.priority === 'now' || item.status === 'due' || (due && due <= now)) {
      sections.now.push(item);
    } else if (item.priority === 'today' || (due && due <= endToday)) {
      sections.today.push(item);
    } else if (item.priority === 'week' || (due && due <= endWeek)) {
      sections.week.push(item);
    } else {
      sections.watching.push(item);
    }
  }

  const severityRank = { critical: 0, warning: 1, informational: 2 } as const;
  for (const section of Object.values(sections) as WorkItem[][]) {
    section.sort((a: WorkItem, b: WorkItem) => {
      const severityDelta = severityRank[a.severity] - severityRank[b.severity];
      if (severityDelta !== 0) return severityDelta;
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
  }

  return sections;
}

export async function getDailyLoop(
  supabase: SupabaseClient,
  providerId: string,
  filter: DailyLoopFilter = {},
  paginationInput: DailyLoopPaginationInput = {},
): Promise<DailyLoopResult> {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const limit = Math.min(Math.max(paginationInput.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(paginationInput.offset ?? 0, 0);

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organizations(timezone)')
    .eq('user_id', providerId)
    .eq('status', 'active')
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();
  const organization = Array.isArray(membership?.organizations)
    ? membership?.organizations[0]
    : membership?.organizations;
  const requestedTimeZone = organization && typeof organization === 'object' && 'timezone' in organization
    ? String(organization.timezone)
    : DEFAULT_TIME_ZONE;
  const dayBounds = getZonedDayBounds(now, requestedTimeZone);

  let itemsQuery = supabase
    .from('work_items')
    .select(WORK_ITEM_SELECT, { count: 'exact' })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  let overdueQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .lt('due_at', now.toISOString());
  let dueTodayQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .gte('due_at', dayBounds.start.toISOString())
    .lt('due_at', dayBounds.endExclusive.toISOString());
  let priorityTodayWithoutDueQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .eq('priority', 'today')
    .is('due_at', null);
  let closedQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .eq('status', 'closed')
    .gte('closed_at', sevenDaysAgo.toISOString());
  let createdQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .gte('created_at', sevenDaysAgo.toISOString());
  let createdClosedQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .eq('status', 'closed')
    .gte('created_at', sevenDaysAgo.toISOString());
  let unacceptedQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .is('accepted_at', null);
  let awaitingOutcomeQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .not('underlying_alert_resolved_at', 'is', null);
  // Offers are not part of this provider's queue, so the queue filters do not apply to them.
  const pendingTransfersQuery = supabase
    .from('work_items')
    .select('id', { count: 'exact', head: true })
    .eq('transfer_pending_to', providerId)
    .neq('status', 'closed');

  if (filter.severity) {
    itemsQuery = itemsQuery.eq('severity', filter.severity);
    overdueQuery = overdueQuery.eq('severity', filter.severity);
    dueTodayQuery = dueTodayQuery.eq('severity', filter.severity);
    priorityTodayWithoutDueQuery = priorityTodayWithoutDueQuery.eq('severity', filter.severity);
    closedQuery = closedQuery.eq('severity', filter.severity);
    createdQuery = createdQuery.eq('severity', filter.severity);
    createdClosedQuery = createdClosedQuery.eq('severity', filter.severity);
    unacceptedQuery = unacceptedQuery.eq('severity', filter.severity);
    awaitingOutcomeQuery = awaitingOutcomeQuery.eq('severity', filter.severity);
  }
  if (filter.priority) {
    itemsQuery = itemsQuery.eq('priority', filter.priority);
    overdueQuery = overdueQuery.eq('priority', filter.priority);
    dueTodayQuery = dueTodayQuery.eq('priority', filter.priority);
    priorityTodayWithoutDueQuery = priorityTodayWithoutDueQuery.eq('priority', filter.priority);
    closedQuery = closedQuery.eq('priority', filter.priority);
    createdQuery = createdQuery.eq('priority', filter.priority);
    createdClosedQuery = createdClosedQuery.eq('priority', filter.priority);
    unacceptedQuery = unacceptedQuery.eq('priority', filter.priority);
    awaitingOutcomeQuery = awaitingOutcomeQuery.eq('priority', filter.priority);
  }
  if (filter.sourceType) {
    itemsQuery = itemsQuery.eq('source_type', filter.sourceType);
    overdueQuery = overdueQuery.eq('source_type', filter.sourceType);
    dueTodayQuery = dueTodayQuery.eq('source_type', filter.sourceType);
    priorityTodayWithoutDueQuery = priorityTodayWithoutDueQuery.eq('source_type', filter.sourceType);
    closedQuery = closedQuery.eq('source_type', filter.sourceType);
    createdQuery = createdQuery.eq('source_type', filter.sourceType);
    createdClosedQuery = createdClosedQuery.eq('source_type', filter.sourceType);
    unacceptedQuery = unacceptedQuery.eq('source_type', filter.sourceType);
    awaitingOutcomeQuery = awaitingOutcomeQuery.eq('source_type', filter.sourceType);
  }

  const [
    itemsResult,
    overdueResult,
    dueTodayResult,
    priorityTodayWithoutDueResult,
    closedResult,
    createdResult,
    createdClosedResult,
    unacceptedResult,
    awaitingOutcomeResult,
    pendingTransfersResult,
  ] = await Promise.all([
    itemsQuery,
    overdueQuery,
    dueTodayQuery,
    priorityTodayWithoutDueQuery,
    closedQuery,
    createdQuery,
    createdClosedQuery,
    unacceptedQuery,
    awaitingOutcomeQuery,
    pendingTransfersQuery,
  ]);

  if (
    itemsResult.error || overdueResult.error || dueTodayResult.error ||
    priorityTodayWithoutDueResult.error || closedResult.error ||
    createdResult.error || createdClosedResult.error ||
    unacceptedResult.error || awaitingOutcomeResult.error || pendingTransfersResult.error
  ) {
    return {
      sections: EMPTY_SECTIONS,
      metrics: EMPTY_METRICS,
      pagination: { total: 0, limit, offset, hasNext: false, hasPrevious: offset > 0 },
      timeZone: dayBounds.timeZone,
      error: 'The operational queue could not be loaded. Do not interpret this as no work.',
    };
  }

  const items = (itemsResult.data ?? []).map(toWorkItem);

  const total = itemsResult.count ?? 0;
  const overdue = overdueResult.count ?? 0;
  const dueToday = (dueTodayResult.count ?? 0) + (priorityTodayWithoutDueResult.count ?? 0);
  const closedLast7Days = closedResult.count ?? 0;
  const createdLast7Days = createdResult.count ?? 0;
  const createdAndClosedLast7Days = createdClosedResult.count ?? 0;

  return {
    sections: groupDailyLoopItems(items, now, dayBounds.timeZone),
    metrics: {
      open: total,
      overdue,
      dueToday,
      closedLast7Days,
      completionRate7Days:
        createdLast7Days > 0
          ? Math.round((createdAndClosedLast7Days / createdLast7Days) * 100)
          : null,
      unaccepted: unacceptedResult.count ?? 0,
      awaitingOutcome: awaitingOutcomeResult.count ?? 0,
      pendingTransfers: pendingTransfersResult.count ?? 0,
    },
    pagination: {
      total,
      limit,
      offset,
      hasNext: offset + items.length < total,
      hasPrevious: offset > 0,
    },
    timeZone: dayBounds.timeZone,
    error: null,
  };
}

export async function getPatientWorkItems(
  supabase: SupabaseClient,
  providerId: string,
  patientId: string,
): Promise<{ items: WorkItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from('work_items')
    .select(WORK_ITEM_SELECT)
    .eq('assigned_to', providerId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return { items: [], error: 'Patient work could not be loaded.' };
  const items = (data ?? []).map(toWorkItem);
  return { items, error: null };
}

/**
 * Transfers offered to this provider. The item stays with the previous accountable
 * provider until the offer is accepted, so these rows are outside the provider queue.
 */
export async function getTransfersAwaitingMe(
  supabase: SupabaseClient,
  providerId: string,
): Promise<{ transfers: PendingTransfer[]; error: string | null }> {
  const { data, error } = await supabase
    .from('work_items')
    .select(
      'id, organization_id, patient_id, title, reason, severity, status, due_at, transfer_offered_at, patients!work_items_patient_id_fkey(profiles!patients_id_fkey(full_name)), offered_by:profiles!work_items_transfer_offered_by_fkey(full_name)',
    )
    .eq('transfer_pending_to', providerId)
    .neq('status', 'closed')
    .order('transfer_offered_at', { ascending: true })
    .limit(30);

  if (error) return { transfers: [], error: 'Transfers offered to you could not be loaded.' };
  const transfers = (data ?? []).map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    patient_id: row.patient_id,
    patient_name: extractPatientFullName(row.patients) ?? 'Patient',
    title: row.title,
    reason: row.reason,
    severity: row.severity,
    status: row.status,
    due_at: row.due_at,
    transfer_offered_at: row.transfer_offered_at,
    offered_by_name: extractFullName(row.offered_by) ?? null,
  })) as PendingTransfer[];
  return { transfers, error: null };
}

export async function getSavedQueueViews(
  supabase: SupabaseClient,
  providerId: string,
): Promise<{ views: SavedQueueView[]; error: string | null }> {
  const { data, error } = await supabase
    .from('provider_saved_views')
    .select('id, name, severity, priority, source_type')
    .eq('provider_id', providerId)
    .order('name');
  if (error) return { views: [], error: 'Saved queue views could not be loaded.' };
  return { views: (data ?? []) as SavedQueueView[], error: null };
}
