'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  Loader2,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { assignWorkItem, bulkReviewWorkItems, transitionWorkItem } from '@/lib/daily-loop/actions';
import type { TeamMember } from '@/lib/team/types';
import type {
  DailyLoopMetrics,
  DailyLoopResult,
  DailyLoopSections,
  WorkItem,
  WorkStatus,
} from '@/lib/daily-loop/types';

const SECTION_CONFIG = {
  now: {
    title: 'Now',
    description: 'Overdue or time-sensitive work requiring review now.',
    icon: AlertCircle,
    tone: 'border-red-200 bg-red-50/40',
  },
  today: {
    title: 'Today',
    description: 'Work expected before the end of this shift or day.',
    icon: Clock3,
    tone: 'border-amber-200 bg-amber-50/40',
  },
  week: {
    title: 'This week',
    description: 'Planned optimization and follow-up due in seven days.',
    icon: CalendarClock,
    tone: 'border-blue-200 bg-blue-50/30',
  },
  watching: {
    title: 'Watching',
    description: 'Relevant signals without an immediate action deadline.',
    icon: Eye,
    tone: 'border-slate-200 bg-slate-50/50',
  },
} as const;

const STATUS_LABELS: Record<WorkStatus, string> = {
  new: 'New',
  reviewed: 'Reviewed',
  actioned: 'Actioned',
  awaiting: 'Awaiting',
  due: 'Due',
  closed: 'Closed',
};

function MetricStrip({ metrics }: { metrics: DailyLoopMetrics }) {
  const values = [
    { label: 'Open', value: metrics.open, tone: 'text-slate-900' },
    { label: 'Overdue', value: metrics.overdue, tone: metrics.overdue ? 'text-red-700' : 'text-slate-900' },
    { label: 'Due today', value: metrics.dueToday, tone: 'text-amber-700' },
    { label: 'Closed · 7d', value: metrics.closedLast7Days, tone: 'text-emerald-700' },
    {
      label: '7d closure',
      value: metrics.completionRate7Days === null ? '—' : `${metrics.completionRate7Days}%`,
      tone: 'text-blue-700',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Daily Loop metrics">
      {values.map((item) => (
        <div key={item.label} className="rounded-xl border bg-white px-4 py-3">
          <p className={`text-2xl font-bold ${item.tone}`}>{item.value}</p>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function WorkItemCard({
  item,
  teamMembers,
  canManage,
  selected,
  onSelectionChange,
}: {
  item: WorkItem;
  teamMembers: TeamMember[];
  canManage: boolean;
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'none' | 'actioned' | 'awaiting' | 'closed'>('none');
  const [error, setError] = useState<string | null>(null);

  const dueLabel = item.due_at
    ? formatDistanceToNow(new Date(item.due_at), { addSuffix: true })
    : 'No deadline';
  const freshLabel = item.freshness_at
    ? formatDistanceToNow(new Date(item.freshness_at), { addSuffix: true })
    : 'Unknown freshness';
  const assignableMembers = teamMembers.filter(
    (member) => member.organization_id === item.organization_id,
  );

  const transition = (
    status: 'reviewed' | 'actioned' | 'awaiting' | 'closed',
    extra: { outcome?: string; snoozeReason?: string; dueAt?: string } = {},
  ) => {
    setError(null);
    startTransition(async () => {
      const result = await transitionWorkItem({
        workItemId: item.id,
        patientId: item.patient_id,
        status,
        ...extra,
      });
      if (!result.success) setError(result.error ?? 'Unable to update work');
      else setMode('none');
    });
  };

  const assign = (assigneeId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await assignWorkItem({ workItemId: item.id, assigneeId });
      if (!result.success) setError(result.error ?? 'Unable to reassign work');
    });
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="work-item-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {(item.status === 'new' || item.status === 'due') && (
              <label className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border bg-white" title="Select for bulk review">
                <span className="sr-only">Select {item.title} for bulk review</span>
                <input type="checkbox" checked={selected} onChange={(event) => onSelectionChange(event.target.checked)} className="size-4" />
              </label>
            )}
            <Link href={`/patients/${item.patient_id}`} className="font-semibold text-blue-700 hover:underline">
              {item.patient_name}
            </Link>
            <Badge variant="outline" className={
              item.severity === 'critical'
                ? 'border-red-200 bg-red-50 text-red-700'
                : item.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }>
              {item.severity}
            </Badge>
            <Badge variant="secondary">{STATUS_LABELS[item.status]}</Badge>
          </div>
          <h3 className="mt-2 text-base font-semibold text-slate-950">{item.title}</h3>
          {item.change_summary && <p className="mt-1 text-sm text-slate-700">{item.change_summary}</p>}
        </div>
        <Link
          href={`/patients/${item.patient_id}`}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
        >
          Open case <ChevronRight className="size-4" />
        </Link>
      </div>

      <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
        <div><dt className="font-semibold text-slate-700">Due</dt><dd>{dueLabel}</dd></div>
        <div><dt className="font-semibold text-slate-700">Owner</dt><dd>{item.owner_name}</dd></div>
        <div><dt className="font-semibold text-slate-700">Data</dt><dd>{item.data_quality} · {freshLabel}</dd></div>
      </dl>

      <details className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Why is this item here?</summary>
        <p className="mt-2 text-slate-600">{item.reason}</p>
        <p className="mt-2 text-xs text-slate-500">Source: {item.source_type.replaceAll('_', ' ')}</p>
      </details>

      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}

      {mode === 'awaiting' && (
        <form
          className="mt-3 grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const localDate = String(form.get('dueAt'));
            const dueDate = new Date(localDate);
            if (Number.isNaN(dueDate.getTime())) {
              setError('Enter a valid return date.');
              return;
            }
            transition('awaiting', {
              snoozeReason: String(form.get('reason')),
              dueAt: dueDate.toISOString(),
            });
          }}
        >
          <label className="text-sm font-medium text-slate-800">
            Waiting for
            <input name="reason" required minLength={3} maxLength={500} className="mt-1 min-h-10 w-full rounded-md border bg-white px-3" />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Return to queue
            <input name="dueAt" type="datetime-local" required className="mt-1 min-h-10 w-full rounded-md border bg-white px-3" />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>Save awaiting state</Button>
            <Button type="button" variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === 'actioned' && (
        <form
          className="mt-3 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            transition('actioned', { outcome: String(new FormData(event.currentTarget).get('outcome')) });
          }}
        >
          <label className="block text-sm font-medium text-slate-800">
            Document action taken
            <textarea name="outcome" required minLength={3} maxLength={1000} rows={2} className="mt-1 w-full rounded-md border bg-white px-3 py-2" />
          </label>
          <div className="flex gap-2"><Button type="submit" className="min-h-11" disabled={pending}>Save action</Button><Button type="button" className="min-h-11" variant="ghost" onClick={() => setMode('none')}>Cancel</Button></div>
        </form>
      )}

      {mode === 'closed' && (
        <form
          className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            transition('closed', { outcome: String(new FormData(event.currentTarget).get('outcome')) });
          }}
        >
          <label className="block text-sm font-medium text-slate-800">
            Outcome required to close
            <textarea name="outcome" required minLength={3} maxLength={1000} rows={2} className="mt-1 w-full rounded-md border bg-white px-3 py-2" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>Close item</Button>
            <Button type="button" variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
          </div>
        </form>
      )}

      {mode === 'none' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(item.status === 'new' || item.status === 'due') && (
            <Button className="min-h-11" size="sm" variant="outline" disabled={pending} onClick={() => transition('reviewed')}>
              <CircleDot className="mr-1 size-3.5" /> Review
            </Button>
          )}
          {item.status !== 'actioned' && (
            <Button className="min-h-11" size="sm" variant="outline" disabled={pending} onClick={() => setMode('actioned')}>
              <ShieldCheck className="mr-1 size-3.5" /> Action taken
            </Button>
          )}
          <Button className="min-h-11" size="sm" variant="outline" disabled={pending} onClick={() => setMode('awaiting')}>
            <Clock3 className="mr-1 size-3.5" /> Awaiting
          </Button>
          <Button className="min-h-11" size="sm" disabled={pending} onClick={() => setMode('closed')}>
            {pending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 size-3.5" />}
            Close
          </Button>
          {canManage && assignableMembers.length > 1 && (
            <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-slate-700">
              <UserRoundCheck className="size-4" /> Delegate
              <select
                aria-label={`Assign ${item.title}`}
                defaultValue={item.assigned_to}
                disabled={pending}
                onChange={(event) => assign(event.target.value)}
                className="min-h-11 rounded-md border bg-white px-2"
              >
                {assignableMembers.map((member) => (
                  <option key={member.member_id} value={member.member_id}>{member.member_name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </article>
  );
}

function DailyLoopSection({
  sectionKey,
  items,
  teamMembers,
  manageableOrganizationIds,
  selectedIds,
  onSelectionChange,
}: {
  sectionKey: keyof DailyLoopSections;
  items: WorkItem[];
  teamMembers: TeamMember[];
  manageableOrganizationIds: string[];
  selectedIds: Set<string>;
  onSelectionChange: (itemId: string, selected: boolean) => void;
}) {
  const config = SECTION_CONFIG[sectionKey];
  const Icon = config.icon;
  return (
    <section className={`rounded-2xl border p-4 ${config.tone}`} aria-labelledby={`daily-${sectionKey}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id={`daily-${sectionKey}`} className="flex items-center gap-2 text-lg font-bold text-slate-950">
            <Icon className="size-5" aria-hidden="true" /> {config.title}
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{items.length}</span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">{config.description}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white/70 px-4 py-6 text-sm text-slate-600">
          No work in this time horizon. Queue loaded successfully.
        </div>
      ) : (
        <div className="space-y-3">{items.map((item) => (
          <WorkItemCard
            key={item.id}
            item={item}
            teamMembers={teamMembers}
            canManage={manageableOrganizationIds.includes(item.organization_id)}
            selected={selectedIds.has(item.id)}
            onSelectionChange={(selected) => onSelectionChange(item.id, selected)}
          />
        ))}</div>
      )}
    </section>
  );
}

export function DailyLoop({
  sections,
  metrics,
  pagination,
  page,
  queryString,
  timeZone,
  teamMembers = [],
  manageableOrganizationIds = [],
}: {
  sections: DailyLoopSections;
  metrics: DailyLoopMetrics;
  pagination: DailyLoopResult['pagination'];
  page: number;
  queryString: string;
  timeZone: string;
  teamMembers?: TeamMember[];
  manageableOrganizationIds?: string[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const loadedCount = useMemo(() => Object.values(sections).reduce((sum, items) => sum + items.length, 0), [sections]);
  const setSelected = (itemId: string, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(itemId); else next.delete(itemId);
      return next;
    });
  };
  const reviewSelected = () => {
    setBulkMessage(null);
    startBulkTransition(async () => {
      const result = await bulkReviewWorkItems([...selectedIds]);
      if (!result.success) setBulkMessage(result.error ?? 'Bulk review failed.');
      else {
        setBulkMessage(`${result.updated ?? 0} item(s) marked reviewed.`);
        setSelectedIds(new Set());
      }
    });
  };
  return (
    <div className="space-y-5" data-testid="daily-loop">
      <MetricStrip metrics={metrics} />
      <div className="flex flex-col gap-2 rounded-xl border bg-white px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {pagination.total === 0 ? 0 : pagination.offset + 1}–{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total.toLocaleString()} assigned items
        </p>
        <p className="text-xs">Day boundary: {timeZone}</p>
      </div>
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-blue-300 bg-blue-50 p-3 shadow-lg" role="region" aria-label="Bulk work actions">
          <span className="mr-auto text-sm font-bold text-blue-950">{selectedIds.size} selected</span>
          <Button className="min-h-11" disabled={bulkPending} onClick={reviewSelected}>{bulkPending ? 'Reviewing…' : 'Confirm review selected'}</Button>
          <Button className="min-h-11" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
        </div>
      )}
      {bulkMessage && <p role="status" className="rounded-lg border bg-white p-3 text-sm text-slate-700">{bulkMessage}</p>}
      {pagination.total === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Queue loaded successfully. No open operational work is assigned to you.
        </div>
      )}
      {pagination.total > 0 && loadedCount === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          This page is beyond the current queue. <Link href={`/dashboard?${queryString}`} className="font-semibold underline">Return to the first page</Link>.
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        {(Object.keys(SECTION_CONFIG) as Array<keyof DailyLoopSections>).map((key) => (
          <DailyLoopSection
            key={key}
            sectionKey={key}
            items={sections[key]}
            teamMembers={teamMembers}
            manageableOrganizationIds={manageableOrganizationIds}
            selectedIds={selectedIds}
            onSelectionChange={setSelected}
          />
        ))}
      </div>
      {(pagination.hasPrevious || pagination.hasNext) && (
        <nav className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3" aria-label="Daily Loop pages">
          {pagination.hasPrevious ? (
            <Link href={`/dashboard?${queryString}${queryString ? '&' : ''}page=${Math.max(page - 1, 1)}`} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold">Previous</Link>
          ) : <span />}
          <span className="text-sm font-semibold text-slate-700">Page {page} of {Math.max(Math.ceil(pagination.total / pagination.limit), 1)}</span>
          {pagination.hasNext ? (
            <Link href={`/dashboard?${queryString}${queryString ? '&' : ''}page=${page + 1}`} className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">Next</Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
