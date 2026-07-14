import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractFullName, extractPatientFullName } from '@/lib/supabase/types';
import type {
  DailyLoopFilter,
  DailyLoopMetrics,
  DailyLoopResult,
  DailyLoopSections,
  SavedQueueView,
  WorkItem,
} from './types';

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
};

export function groupDailyLoopItems(
  items: WorkItem[],
  now = new Date(),
): DailyLoopSections {
  const sections: DailyLoopSections = {
    now: [],
    today: [],
    week: [],
    watching: [],
  };
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const endWeek = new Date(now);
  endWeek.setDate(endWeek.getDate() + 7);

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
): Promise<DailyLoopResult> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let itemsQuery = supabase
    .from('work_items')
    .select(
      'id, organization_id, patient_id, provider_id, assigned_to, source_type, source_id, title, reason, change_summary, priority, severity, status, due_at, freshness_at, data_quality, created_at, updated_at, patients!work_items_patient_id_fkey(profiles(full_name)), assignee:profiles!work_items_assigned_to_fkey(full_name)'
    )
    .eq('assigned_to', providerId)
    .neq('status', 'closed')
    .order('due_at', { ascending: true, nullsFirst: false });
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

  if (filter.severity) {
    itemsQuery = itemsQuery.eq('severity', filter.severity);
    closedQuery = closedQuery.eq('severity', filter.severity);
    createdQuery = createdQuery.eq('severity', filter.severity);
    createdClosedQuery = createdClosedQuery.eq('severity', filter.severity);
  }
  if (filter.priority) {
    itemsQuery = itemsQuery.eq('priority', filter.priority);
    closedQuery = closedQuery.eq('priority', filter.priority);
    createdQuery = createdQuery.eq('priority', filter.priority);
    createdClosedQuery = createdClosedQuery.eq('priority', filter.priority);
  }
  if (filter.sourceType) {
    itemsQuery = itemsQuery.eq('source_type', filter.sourceType);
    closedQuery = closedQuery.eq('source_type', filter.sourceType);
    createdQuery = createdQuery.eq('source_type', filter.sourceType);
    createdClosedQuery = createdClosedQuery.eq('source_type', filter.sourceType);
  }

  const [itemsResult, closedResult, createdResult, createdClosedResult] = await Promise.all([
    itemsQuery,
    closedQuery,
    createdQuery,
    createdClosedQuery,
  ]);

  if (itemsResult.error) {
    return {
      sections: EMPTY_SECTIONS,
      metrics: EMPTY_METRICS,
      error: 'The operational queue could not be loaded. Do not interpret this as no work.',
    };
  }

  const items = (itemsResult.data ?? []).map((row) => ({
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
  })) as WorkItem[];

  const now = new Date();
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  const overdue = items.filter((item) => item.due_at && new Date(item.due_at) < now).length;
  const dueToday = items.filter((item) => {
    if (!item.due_at) return item.priority === 'today';
    const due = new Date(item.due_at);
    return due >= now && due <= endToday;
  }).length;
  const closedLast7Days = closedResult.count ?? 0;
  const createdLast7Days = createdResult.count ?? 0;
  const createdAndClosedLast7Days = createdClosedResult.count ?? 0;

  return {
    sections: groupDailyLoopItems(items, now),
    metrics: {
      open: items.length,
      overdue,
      dueToday,
      closedLast7Days,
      completionRate7Days:
        createdLast7Days > 0
          ? Math.round((createdAndClosedLast7Days / createdLast7Days) * 100)
          : null,
    },
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
    .select(
      'id, organization_id, patient_id, provider_id, assigned_to, source_type, source_id, title, reason, change_summary, priority, severity, status, due_at, freshness_at, data_quality, created_at, updated_at, patients!work_items_patient_id_fkey(profiles(full_name)), assignee:profiles!work_items_assigned_to_fkey(full_name)'
    )
    .eq('assigned_to', providerId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) return { items: [], error: 'Patient work could not be loaded.' };
  const items = (data ?? []).map((row) => ({
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
  })) as WorkItem[];
  return { items, error: null };
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
