export type WorkPriority = 'now' | 'today' | 'week' | 'watching';
export type WorkSeverity = 'critical' | 'warning' | 'informational';
export type WorkStatus = 'new' | 'reviewed' | 'actioned' | 'awaiting' | 'due' | 'closed';
export type DataQuality = 'verified' | 'partial' | 'stale' | 'unknown';

export interface WorkItem {
  id: string;
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
}

export interface DailyLoopResult {
  sections: DailyLoopSections;
  metrics: DailyLoopMetrics;
  error: string | null;
}
