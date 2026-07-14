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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { transitionWorkItem } from '@/lib/daily-loop/actions';
import type {
  DailyLoopMetrics,
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

function WorkItemCard({ item }: { item: WorkItem }) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'none' | 'awaiting' | 'closed'>('none');
  const [error, setError] = useState<string | null>(null);

  const dueLabel = item.due_at
    ? formatDistanceToNow(new Date(item.due_at), { addSuffix: true })
    : 'No deadline';
  const freshLabel = item.freshness_at
    ? formatDistanceToNow(new Date(item.freshness_at), { addSuffix: true })
    : 'Unknown freshness';

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

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="work-item-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white"
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
        <div className="mt-4 flex flex-wrap gap-2">
          {(item.status === 'new' || item.status === 'due') && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => transition('reviewed')}>
              <CircleDot className="mr-1 size-3.5" /> Review
            </Button>
          )}
          {item.status !== 'actioned' && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => transition('actioned')}>
              <ShieldCheck className="mr-1 size-3.5" /> Action taken
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setMode('awaiting')}>
            <Clock3 className="mr-1 size-3.5" /> Awaiting
          </Button>
          <Button size="sm" disabled={pending} onClick={() => setMode('closed')}>
            {pending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 size-3.5" />}
            Close
          </Button>
        </div>
      )}
    </article>
  );
}

function DailyLoopSection({ sectionKey, items }: { sectionKey: keyof DailyLoopSections; items: WorkItem[] }) {
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
        <div className="space-y-3">{items.map((item) => <WorkItemCard key={item.id} item={item} />)}</div>
      )}
    </section>
  );
}

export function DailyLoop({ sections, metrics }: { sections: DailyLoopSections; metrics: DailyLoopMetrics }) {
  const total = useMemo(() => Object.values(sections).reduce((sum, items) => sum + items.length, 0), [sections]);
  return (
    <div className="space-y-5" data-testid="daily-loop">
      <MetricStrip metrics={metrics} />
      {total === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          Queue loaded successfully. No open operational work is assigned to you.
        </div>
      )}
      <div className="grid gap-5 xl:grid-cols-2">
        {(Object.keys(SECTION_CONFIG) as Array<keyof DailyLoopSections>).map((key) => (
          <DailyLoopSection key={key} sectionKey={key} items={sections[key]} />
        ))}
      </div>
    </div>
  );
}
