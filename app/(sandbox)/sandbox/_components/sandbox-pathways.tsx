'use client';

import Link from 'next/link';
import { ArrowUpRight, BookOpenCheck, CheckCircle2, Circle, FlaskConical, Route, ShieldAlert } from 'lucide-react';
import { SANDBOX_PATHWAYS } from '@/lib/sandbox/fixtures';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SectionHeading, SyntheticBanner } from './sandbox-ui';

const EVIDENCE_STYLE = {
  Established: 'bg-emerald-100 text-emerald-800',
  Emerging: 'bg-amber-100 text-amber-900',
  Pragmatic: 'bg-slate-100 text-slate-700',
  Proposed: 'bg-violet-100 text-violet-800',
};

export function SandboxPathways({ exploredPathways, onExplore }: {
  exploredPathways: string[];
  onExplore: (pathwayId: string) => void;
}) {
  return (
    <div className="space-y-7" data-testid="sandbox-pathways">
      <SectionHeading eyebrow="Educational implementation toolkit" title="Protocol pathways in workflow context" description="The sandbox explains where each HEARTLAND module enters the loop, then opens the real public interactive tool with no clinical data attached." />
      <SyntheticBanner>Pathway examples use fictional context. Evidence labels and safety gates remain visible; no module produces an autonomous patient-specific recommendation.</SyntheticBanner>

      <section className="rounded-2xl border bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Route className="mt-1 size-6 shrink-0 text-blue-700" />
          <div><h2 className="text-xl font-bold text-slate-950">Featured cross-module journey</h2><p className="mt-2 text-sm leading-6 text-slate-600">Maria’s persistent monitoring signal opens a source check, then relevant risk/GDMT/titration references, documentation, team routing, and a scheduled return to the queue.</p></div>
        </div>
        <ol className="mt-5 grid gap-3 md:grid-cols-5">
          {['Signal coalesced', 'Source verified', 'Pathway reviewed', 'Action documented', 'Follow-up returns'].map((step, index) => <li key={step} className="rounded-xl bg-slate-50 p-4 text-sm"><span className="text-xs font-bold text-blue-700">0{index + 1}</span><p className="mt-2 font-semibold text-slate-900">{step}</p></li>)}
        </ol>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Interactive HEARTLAND pathways">
        {SANDBOX_PATHWAYS.map((pathway) => {
          const explored = exploredPathways.includes(pathway.id);
          return (
            <article key={pathway.id} className="flex flex-col rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{pathway.module}</p><h2 className="mt-1 text-xl font-bold text-slate-950">{pathway.title}</h2></div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${EVIDENCE_STYLE[pathway.evidence]}`}>{pathway.evidence}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{pathway.description}</p>
              <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"><strong>In this scenario:</strong> {pathway.scenarioUse}</div>
              <ol className="mt-4 space-y-2">{pathway.steps.map((step, index) => <li key={step} className="flex gap-2 text-sm text-slate-700"><span className="font-bold text-slate-400">{index + 1}.</span>{step}</li>)}</ol>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-5">
                <Link href={pathway.href} className={cn(buttonVariants(), 'min-h-11')} onClick={() => onExplore(pathway.id)}>Open interactive tool <ArrowUpRight className="ml-2 size-4" /></Link>
                <button type="button" onClick={() => onExplore(pathway.id)} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
                  {explored ? <CheckCircle2 className="size-5 text-emerald-700" /> : <Circle className="size-5" />}{explored ? 'Explored' : 'Mark explored'}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <IntegratedModule module="Module 4" title="Discharge transitions" description="Demonstrated in Care Coordination with 48-hour, Day 7, Day 14, and Day 30 closed-loop milestones." />
        <IntegratedModule module="Module 6" title="Comorbidity context" description="Represented inside Patient 360 so CKM stage, renal safety, symptoms, and medication context remain connected." />
        <IntegratedModule module="Module 7" title="Primary care linkage" description="Demonstrated through team ownership, SBAR handoff, delivery evidence, and patient-controlled access." />
      </section>

      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <div className="flex gap-3"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-800" /><div><h2 className="font-bold text-amber-950">Framework status remains visible</h2><p className="mt-2 text-sm leading-6 text-amber-900">The HEARTLAND Risk Stratification Framework is proposed and not validated against clinical outcomes. The sandbox demonstrates implementation logic, not efficacy.</p></div></div>
      </section>

      <div className="rounded-2xl border bg-slate-950 p-5 text-white sm:p-6">
        <BookOpenCheck className="size-6 text-blue-300" />
        <h2 className="mt-3 text-xl font-bold">Pathway exploration: {exploredPathways.length}/{SANDBOX_PATHWAYS.length}</h2>
        <p className="mt-2 text-sm text-slate-300">Progress is local and helps demonstrate which parts of the product a tester actually explored.</p>
      </div>
    </div>
  );
}

function IntegratedModule({ module, title, description }: { module: string; title: string; description: string }) {
  return <article className="rounded-2xl border bg-white p-5"><FlaskConical className="size-5 text-violet-700" /><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-violet-700">{module}</p><h3 className="mt-1 font-bold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p></article>;
}
