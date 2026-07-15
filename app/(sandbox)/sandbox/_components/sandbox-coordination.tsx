'use client';

import { CheckCircle2, Clock3, FileText, LockKeyhole, MailCheck, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { SANDBOX_DISCHARGE_STEPS, SANDBOX_TASKS, SANDBOX_TEAM } from '@/lib/sandbox/fixtures';
import type { SandboxTaskState } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { MetricCard, SectionHeading, SyntheticBanner } from './sandbox-ui';

export function SandboxCoordination({ taskStates, onReassign, onDocumentAction }: {
  taskStates: Record<string, SandboxTaskState>;
  onReassign: (taskId: string, owner: string) => void;
  onDocumentAction: (action: string) => void;
}) {
  const assignableTask = SANDBOX_TASKS.find((task) => taskStates[task.id]?.status !== 'closed') ?? SANDBOX_TASKS[0];
  const currentOwner = taskStates[assignableTask.id]?.owner ?? assignableTask.owner;

  return (
    <div className="space-y-7" data-testid="sandbox-coordination">
      <SectionHeading eyebrow="Team operations" title="Care coordination and closed-loop transitions" description="Ownership, workload, delivery evidence, handoff, patient access, and scheduled milestones stay visible instead of disappearing into notes." />
      <SyntheticBanner>Assignments, messages, access relationships, and follow-ups below are simulated. No real user receives anything.</SyntheticBanner>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Team members" value={SANDBOX_TEAM.length} detail="Role and coverage explicit." tone="blue" />
        <MetricCard label="Assigned work" value={Object.keys(taskStates).length} detail="Every item has an owner." />
        <MetricCard label="Delivery confirmed" value="2/3" detail="One synthetic message unread." tone="violet" />
        <MetricCard label="Access reviews" value="Current" detail="Review due in 21 days." tone="emerald" />
      </section>

      <section className="rounded-2xl border bg-white p-5 sm:p-6">
        <div className="flex items-center gap-3"><Users className="size-6 text-blue-700" /><div><h2 className="text-xl font-bold text-slate-950">Team workload</h2><p className="text-sm text-slate-600">Synthetic assignment counts, aging, and coverage.</p></div></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {SANDBOX_TEAM.map((member) => <article key={member.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-950">{member.name}</h3><p className="text-xs text-slate-500">{member.role}</p></div><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-800">{member.workload} items</span></div><p className="mt-3 text-sm text-slate-700">{member.coverage}</p><p className={member.overdue ? 'mt-3 text-xs font-semibold text-amber-800' : 'mt-3 text-xs font-semibold text-emerald-700'}>{member.overdue} overdue</p></article>)}
        </div>

        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-950">Reassign an active item</p>
          <p className="mt-1 text-sm text-slate-600"><strong>{assignableTask.patientName}:</strong> {assignableTask.title}</p>
          <p className="mt-1 text-xs text-slate-500">Current owner: {currentOwner}</p>
          <div className="mt-3 flex flex-wrap gap-2">{SANDBOX_TEAM.map((member) => <Button key={member.id} size="sm" variant={currentOwner === member.name ? 'secondary' : 'outline'} disabled={currentOwner === member.name} onClick={() => onReassign(assignableTask.id, member.name)}>Assign to {member.name.split(',')[0]}</Button>)}</div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div className="rounded-2xl border bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><Clock3 className="size-6 text-violet-700" /><div><h2 className="text-xl font-bold text-slate-950">Discharge transition</h2><p className="text-sm text-slate-600">James Walker · synthetic milestone plan</p></div></div>
          <ol className="mt-5 space-y-3">{SANDBOX_DISCHARGE_STEPS.map((step, index) => <li key={step.label} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[96px_120px_1fr] sm:items-center"><div className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-800">{index + 1}</span><strong className="text-sm">{step.label}</strong></div><span className={step.state === 'Complete' ? 'text-xs font-semibold text-emerald-700' : step.state === 'Due today' ? 'text-xs font-semibold text-amber-800' : 'text-xs font-semibold text-blue-700'}>{step.state}</span><p className="text-sm text-slate-600">{step.detail}</p></li>)}</ol>
          <Button className="mt-4 min-h-11" variant="outline" onClick={() => onDocumentAction('James Walker: Day 14 follow-up confirmed')}>Confirm next milestone</Button>
        </div>

        <div className="rounded-2xl border bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><FileText className="size-6 text-blue-700" /><div><h2 className="text-xl font-bold text-slate-950">SBAR handoff preview</h2><p className="text-sm text-slate-600">Structured from the current synthetic context.</p></div></div>
          <dl className="mt-5 space-y-3 text-sm">
            <HandoffRow term="Situation" detail="Persistent weight/dyspnea signal requires source review and documented disposition." />
            <HandoffRow term="Background" detail="High-risk context, rural distance barrier, Track A monitoring, renal source stale." />
            <HandoffRow term="Assessment" detail="Implementation summary only; independent clinical assessment remains required." />
            <HandoffRow term="Recommendation" detail="Verify source, contact patient, document outcome, schedule return to queue." />
          </dl>
          <Button className="mt-4 min-h-11" onClick={() => onDocumentAction('Maria Santos: synthetic SBAR handoff generated')}><FileText className="mr-2 size-4" /> Generate synthetic handoff</Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <OperationalCard icon={<MailCheck className="size-5 text-blue-700" />} title="Inbox delivery evidence" lines={['Critical outreach · delivered', 'Education reminder · read', 'Follow-up request · unread']} />
        <OperationalCard icon={<LockKeyhole className="size-5 text-violet-700" />} title="Access and review" lines={['3 active synthetic relationships', '0 pending access requests', 'Quarterly review due in 21 days']} />
        <OperationalCard icon={<RefreshCw className="size-5 text-emerald-700" />} title="Degraded workflow" lines={['Printable no-PHI playbook', 'Analog Track B supported', 'Failure never appears as zero work']} />
      </section>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><ShieldCheck className="mr-2 inline size-4" /><strong>Governance:</strong> reassignment, access review, delivery status, and work outcomes remain auditable in the controlled workspace.</div>
    </div>
  );
}

function HandoffRow({ term, detail }: { term: string; detail: string }) {
  return <div className="rounded-xl bg-slate-50 p-4"><dt className="font-bold text-slate-950">{term}</dt><dd className="mt-1 leading-6 text-slate-600">{detail}</dd></div>;
}

function OperationalCard({ icon, title, lines }: { icon: React.ReactNode; title: string; lines: string[] }) {
  return <article className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-2">{icon}<h2 className="font-bold text-slate-950">{title}</h2></div><ul className="mt-4 space-y-3">{lines.map((line) => <li key={line} className="flex items-start gap-2 text-sm text-slate-600"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />{line}</li>)}</ul></article>;
}
