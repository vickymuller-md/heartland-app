'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, Eye, PauseCircle, PhoneCall, PlayCircle } from 'lucide-react';
import type { OutreachWorkItem } from '@/lib/sandbox-ai/fixtures';
import { SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import type { SandboxPriority, SandboxTask, SandboxTaskState, SandboxTaskStatus } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { MetricCard, OutreachDispositionPill, SectionHeading, SeverityPill, StatusPill, SyntheticBanner } from './sandbox-ui';

const PRIORITIES: Array<{ id: 'all' | SandboxPriority; label: string }> = [
  { id: 'all', label: 'All work' }, { id: 'now', label: 'Now' }, { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' }, { id: 'watching', label: 'Watching' },
];

const CLOSE_OUTCOMES = [
  'Patient contacted; follow-up scheduled',
  'Source verified; no escalation required',
  'Routed to clinical owner for independent review',
];

export function SandboxDailyLoop({ taskStates, onTaskState, onOpenPatient, onBulkReview, outreachItems, onOpenOutreach }: {
  taskStates: Record<string, SandboxTaskState>;
  onTaskState: (task: SandboxTask, status: SandboxTaskStatus, outcome?: string) => void;
  onOpenPatient: (patientId: string) => void;
  onBulkReview: (tasks: SandboxTask[]) => void;
  outreachItems: OutreachWorkItem[];
  onOpenOutreach: () => void;
}) {
  const [priority, setPriority] = useState<'all' | SandboxPriority>('all');
  const [closingTaskId, setClosingTaskId] = useState<string | null>(null);
  const visibleTasks = useMemo(() => SANDBOX_TASKS.filter((task) => priority === 'all' || task.priority === priority), [priority]);
  const activeTasks = SANDBOX_TASKS.filter((task) => taskStates[task.id]?.status !== 'closed');
  const visibleOpen = visibleTasks.filter((task) => taskStates[task.id]?.status === 'open');
  const closed = SANDBOX_TASKS.length - activeTasks.length;

  return (
    <div className="space-y-7" data-testid="sandbox-daily-loop">
      <SectionHeading
        eyebrow="Provider workspace"
        title="Daily Loop"
        description="A single operational queue connects signal, reason, owner, source freshness, action, deadline, and outcome. Repeated observations stay coalesced into one evolving item."
        action={<Button variant="outline" className="min-h-11" disabled={visibleOpen.length === 0} onClick={() => onBulkReview(visibleOpen)}><Eye className="mr-2 size-4" /> Review visible ({visibleOpen.length})</Button>}
      />

      <SyntheticBanner>Actions below update only this demonstration. No message, note, assignment, or clinical record is created.</SyntheticBanner>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Daily Loop synthetic metrics">
        <MetricCard label="Open" value={activeTasks.length} detail="All non-closed work." />
        <MetricCard label="Now" value={activeTasks.filter((task) => task.priority === 'now').length} detail="Immediate review queue." tone="amber" />
        <MetricCard label="Due today" value={activeTasks.filter((task) => task.priority === 'today').length} detail="Time-bound workflow." tone="blue" />
        <MetricCard label="Persistent" value={activeTasks.filter((task) => task.occurrences > 1).length} detail="Coalesced repeated signals." tone="violet" />
        <MetricCard label="Closed" value={closed} detail="Outcome required." tone="emerald" />
      </section>

      <section className="rounded-2xl border bg-white p-4" aria-label="Queue filters">
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((item) => (
            <button key={item.id} type="button" aria-pressed={priority === item.id} onClick={() => setPriority(item.id)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition ${priority === item.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">Showing {visibleTasks.length} synthetic items · Filters contain workflow metadata only.</p>
      </section>

      <section className="space-y-4" aria-label="Synthetic work items">
        {visibleTasks.map((task) => {
          const state = taskStates[task.id] ?? { status: 'open', owner: task.owner, updatedLabel: 'Not yet reviewed' };
          return (
            <article key={task.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${state.status === 'closed' ? 'opacity-70' : ''}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onOpenPatient(task.patientId)} className="min-h-11 font-bold text-blue-700 hover:underline">{task.patientName}</button>
                    <SeverityPill severity={task.severity} />
                    <StatusPill status={state.status} />
                    {task.occurrences > 1 && <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">{task.occurrences} observations</span>}
                  </div>
                  <h3 className="mt-2 text-lg font-bold text-slate-950">{task.title}</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{task.reason}</p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                    <span><strong className="text-slate-800">Why:</strong> {task.signal}</span>
                    <span><strong className="text-slate-800">Source:</strong> {task.source}</span>
                    <span><strong className="text-slate-800">Owner:</strong> {state.owner}</span>
                    <span><strong className="text-slate-800">Updated:</strong> {state.updatedLabel}</span>
                  </div>
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><strong>Suggested workflow:</strong> {task.suggestedAction}</div>
                  {state.outcome && <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><strong>Outcome:</strong> {state.outcome}</div>}
                </div>
                <Button variant="outline" className="min-h-11 shrink-0" onClick={() => onOpenPatient(task.patientId)}>Open Patient 360 <ChevronRight className="ml-1 size-4" /></Button>
              </div>

              {state.status !== 'closed' && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
                  <span className="mr-auto inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-amber-800"><Clock3 className="size-4" /> {task.dueLabel}</span>
                  {state.status === 'open' && <Button variant="outline" className="min-h-11" onClick={() => onTaskState(task, 'reviewed')}><Eye className="mr-1 size-4" /> Review</Button>}
                  {!['actioned', 'awaiting'].includes(state.status) && <Button variant="outline" className="min-h-11" onClick={() => onTaskState(task, 'actioned')}><PlayCircle className="mr-1 size-4" /> Action taken</Button>}
                  {state.status !== 'awaiting' && <Button variant="outline" className="min-h-11" onClick={() => onTaskState(task, 'awaiting')}><PauseCircle className="mr-1 size-4" /> Awaiting data/patient</Button>}
                  <Button className="min-h-11" onClick={() => setClosingTaskId(closingTaskId === task.id ? null : task.id)}><CheckCircle2 className="mr-1 size-4" /> Close with outcome</Button>
                </div>
              )}

              {closingTaskId === task.id && state.status !== 'closed' && (
                <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-bold text-emerald-950">Choose a synthetic outcome</p>
                  <p className="mt-1 text-xs text-emerald-800">Production requires a meaningful outcome before work can close.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {CLOSE_OUTCOMES.map((outcome) => <Button key={outcome} size="sm" variant="outline" onClick={() => { onTaskState(task, 'closed', outcome); setClosingTaskId(null); }}>{outcome}</Button>)}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border bg-white p-5" aria-label="Work items from automated outreach" data-testid="daily-loop-outreach">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-950">From automated outreach (demonstration)</h3>
            <p className="mt-1 text-xs text-slate-500">Priority set by registered clinical rules · conversation structured by AI.</p>
          </div>
          <Button variant="outline" className="min-h-11" onClick={onOpenOutreach}><PhoneCall className="mr-2 size-4" /> Open outreach</Button>
        </div>
        <ul className="mt-4 space-y-2">
          {outreachItems.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm">
              <span className="mr-auto min-w-40 font-semibold text-slate-900">{item.patientName}</span>
              <OutreachDispositionPill disposition={item.disposition} />
              <span className="text-xs text-slate-500">{item.atLabel}</span>
              {(item.redFlagMessages.length > 0 || item.note) && (
                <span className="w-full text-xs leading-5 text-slate-600">
                  {item.redFlagMessages.length > 0 ? item.redFlagMessages.join(' · ') : item.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <AlertTriangle className="mr-2 inline size-4" aria-hidden="true" /><strong>Safety behavior:</strong> a technical error must never render as “zero work.” Production shows explicit unavailable/error states and a downtime workflow.
      </div>
    </div>
  );
}
