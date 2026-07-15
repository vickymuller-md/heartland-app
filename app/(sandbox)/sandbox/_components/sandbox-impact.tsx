import Link from 'next/link';
import { ArrowRight, BarChart3, CheckCircle2, Circle, Download, ShieldCheck, Target, TimerReset } from 'lucide-react';
import { SANDBOX_PATHWAYS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import type { SandboxSectionId, SandboxTaskState } from '@/lib/sandbox/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MetricCard, SectionHeading, SyntheticBanner } from './sandbox-ui';

export function SandboxImpact({ visitedSections, exploredPathways, taskStates, documentedActions, patientCheckIns, onReset }: {
  visitedSections: SandboxSectionId[];
  exploredPathways: string[];
  taskStates: Record<string, SandboxTaskState>;
  documentedActions: string[];
  patientCheckIns: string[];
  onReset: () => void;
}) {
  const closed = Object.values(taskStates).filter((state) => state.status === 'closed').length;
  const progressed = Object.values(taskStates).filter((state) => state.status !== 'open').length;
  const tourSteps = [
    { label: 'Visited Daily Loop', done: visitedSections.includes('daily-loop') },
    { label: 'Opened Patient 360', done: visitedSections.includes('patient-360') },
    { label: 'Explored a pathway', done: exploredPathways.length > 0 },
    { label: 'Progressed operational work', done: progressed > 0 },
    { label: 'Documented an action', done: documentedActions.length > 0 },
    { label: 'Completed patient-side work', done: patientCheckIns.length > 0 },
    { label: 'Closed a loop with outcome', done: closed > 0 },
  ];
  const completedTourSteps = tourSteps.filter((step) => step.done).length;
  const progress = Math.round((completedTourSteps / tourSteps.length) * 100);

  return (
    <div className="space-y-7" data-testid="sandbox-impact">
      <SectionHeading eyebrow="Program and adoption view" title="Impact, evidence, and release boundaries" description="This view demonstrates how HEARTLAND measures workflow adoption without turning sandbox activity into clinical or financial efficacy claims." action={<Button variant="outline" className="min-h-11" onClick={onReset}><TimerReset className="mr-2 size-4" /> Reset sandbox</Button>} />
      <SyntheticBanner>All measures on this page are generated from this browser’s fictional tour state. They are not production traction or clinical outcomes.</SyntheticBanner>

      <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-300">Tour completion</p><h2 className="mt-2 text-4xl font-bold">{progress}%</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">You explored {visitedSections.length}/{SANDBOX_SECTIONS.length} areas, {exploredPathways.length}/{SANDBOX_PATHWAYS.length} public pathways, and closed {closed}/{SANDBOX_TASKS.length} synthetic loops.</p></div>
          <div className="rounded-2xl bg-white/10 p-5"><div className="h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-3 text-xs text-slate-300">{completedTourSteps} of {tourSteps.length} activation behaviors completed</p></div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Areas explored" value={`${visitedSections.length}/${SANDBOX_SECTIONS.length}`} detail="Breadth of product discovery." tone="blue" />
        <MetricCard label="Work progressed" value={progressed} detail="Beyond a passive page view." tone="violet" />
        <MetricCard label="Loops closed" value={closed} detail="Outcome captured." tone="emerald" />
        <MetricCard label="Pathways opened" value={exploredPathways.length} detail="Real public tools." tone="amber" />
        <MetricCard label="Patient actions" value={patientCheckIns.length} detail="Synthetic Today engagement." />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
        <div className="rounded-2xl border bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><Target className="size-6 text-blue-700" /><div><h2 className="text-xl font-bold text-slate-950">Activation checklist</h2><p className="text-sm text-slate-600">Value behaviors, not login vanity.</p></div></div>
          <ul className="mt-5 space-y-3">{tourSteps.map((step) => <li key={step.label} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-medium text-slate-700">{step.done ? <CheckCircle2 className="size-5 shrink-0 text-emerald-700" /> : <Circle className="size-5 shrink-0 text-slate-300" />}{step.label}</li>)}</ul>
        </div>

        <div className="rounded-2xl border bg-white p-5 sm:p-6">
          <div className="flex items-center gap-3"><BarChart3 className="size-6 text-violet-700" /><div><h2 className="text-xl font-bold text-slate-950">Program report preview</h2><p className="text-sm text-slate-600">Aggregate operational measures with explicit evidence boundaries.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['Priority work closed on time', 'Operational north-star'],
              ['Time to first meaningful action', 'Time-to-value'],
              ['Weekly and monthly active roles', 'Adoption'],
              ['Follow-ups with documented outcome', 'Closed-loop quality'],
              ['Overrides and missing source data', 'Safety/quality'],
              ['Retention at 4, 8, and 12 weeks', 'Sustained use'],
            ].map(([metric, category]) => <div key={metric} className="rounded-xl border p-4"><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">{category}</p><p className="mt-2 font-bold text-slate-950">{metric}</p><p className="mt-2 text-xs text-slate-500">No patient-level detail in aggregate adoption telemetry.</p></div>)}
          </div>
          <Button variant="outline" className="mt-4 min-h-11" disabled><Download className="mr-2 size-4" /> Synthetic report preview only</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-6">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-6 shrink-0 text-amber-800" /><div><h2 className="text-xl font-bold text-amber-950">What this sandbox cannot prove</h2><p className="mt-2 text-sm leading-6 text-amber-900">It demonstrates product capability and workflow logic. It does not prove reduced hospitalization, clinical efficacy, reimbursement, HIPAA readiness, or safe unsupervised use. Those claims require independent validation, governance, contracts, pilot evidence, and security assurance.</p></div></div>
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6 sm:p-8">
        <h2 className="text-2xl font-bold text-slate-950">Ready for a controlled evaluation?</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700">Clinical workspaces remain separate from this sandbox and require professional review, MFA, governed patient linkage, and organizational approval.</p>
        <div className="mt-5 flex flex-wrap gap-3"><Link href="/request-access" className={cn(buttonVariants(), 'min-h-11')}>Request clinical workspace <ArrowRight className="ml-2 size-4" /></Link><Link href="/guide" className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11')}>Read implementation guide</Link></div>
      </section>
    </div>
  );
}
