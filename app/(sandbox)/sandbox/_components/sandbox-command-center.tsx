import { Activity, ArrowRight, BookOpenCheck, ClipboardCheck, HeartPulse, Network, PhoneCall, ShieldCheck, Users } from 'lucide-react';
import { SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import type { SandboxSectionId, SandboxTaskState } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { MetricCard, SectionHeading, SyntheticBanner } from './sandbox-ui';

const ICONS = [Activity, PhoneCall, ClipboardCheck, HeartPulse, BookOpenCheck, Network, Users, ShieldCheck];

export function SandboxCommandCenter({ taskStates, visitedSections, onNavigate, automatedCallsCount }: {
  taskStates: Record<string, SandboxTaskState>;
  visitedSections: SandboxSectionId[];
  onNavigate: (section: SandboxSectionId) => void;
  automatedCallsCount: number;
}) {
  const closed = Object.values(taskStates).filter((state) => state.status === 'closed').length;
  const actioned = Object.values(taskStates).filter((state) => ['actioned', 'awaiting', 'closed'].includes(state.status)).length;
  const nextSection = SANDBOX_SECTIONS.find((section) => !visitedSections.includes(section.id) && section.id !== 'command')?.id ?? 'daily-loop';

  return (
    <div className="space-y-8" data-testid="sandbox-command-center">
      <section className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-8 text-white sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Full synthetic product tour</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">From a signal to a closed care loop.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Explore the HEARTLAND operational model with realistic synthetic patients: prioritized work, source-aware briefs, protocol pathways, coordination, patient experience, and measurable outcomes.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button className="min-h-11 bg-white text-slate-950 hover:bg-slate-100" onClick={() => onNavigate(nextSection)}>
                Continue guided tour <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button
                className="min-h-11 border border-white bg-white text-slate-950 shadow-sm hover:border-blue-200 hover:bg-blue-50 hover:text-slate-950 focus-visible:ring-white/70"
                data-testid="sandbox-open-patient-360"
                onClick={() => onNavigate('patient-360')}
              >
                Open Patient 360
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5">
            <p className="text-sm font-semibold text-blue-200">Featured synthetic case</p>
            <h2 className="mt-2 text-2xl font-bold">Maria Santos</h2>
            <p className="mt-1 text-sm text-slate-300">High-risk context · Digital Track A · 126 miles to cardiology</p>
            <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-200">Why now</p>
              <p className="mt-1 text-sm font-semibold">Weight +4.2 lb with worsening dyspnea; renal source requires verification.</p>
            </div>
          </div>
        </div>
      </section>

      <SyntheticBanner>
        Names, events, values, messages, access relationships, and outcomes are fictional. Interaction state stays in this browser and never writes to clinical tables.
      </SyntheticBanner>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Sandbox product metrics">
        <MetricCard label="Synthetic patients" value={SANDBOX_PATIENTS.length} detail="Different rural settings and monitoring tracks." tone="blue" />
        <MetricCard label="Operational items" value={SANDBOX_TASKS.length} detail="Now, Today, Week, and Watching." tone="amber" />
        <MetricCard label="Automated calls" value={automatedCallsCount} detail="AI-assisted outreach simulations with rule-based escalation." tone="blue" />
        <MetricCard label="Actions progressed" value={actioned} detail="Reviewed, actioned, awaiting, or closed." tone="violet" />
        <MetricCard label="Loops closed" value={closed} detail="Every closure requires a synthetic outcome." tone="emerald" />
      </section>

      <section className="space-y-5">
        <SectionHeading eyebrow="Product map" title="Eight connected experiences" description="The sandbox mirrors the app’s operational logic instead of presenting isolated screenshots." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SANDBOX_SECTIONS.filter((section) => section.id !== 'command').map((section, index) => {
            const Icon = ICONS[index % ICONS.length];
            const visited = visitedSections.includes(section.id);
            return (
              <button key={section.id} type="button" onClick={() => onNavigate(section.id)} className="group min-h-44 rounded-2xl border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Icon className="size-5" aria-hidden="true" /></span>
                  <span className={visited ? 'text-xs font-semibold text-emerald-700' : 'text-xs font-semibold text-slate-600'}>{visited ? 'Explored' : 'Open'}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-slate-950">{section.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{section.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 sm:p-6">
        <SectionHeading eyebrow="Safety boundary" title="High fidelity without clinical exposure" description="Tester accounts can learn the workflow without inheriting provider permissions." />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            ['Synthetic-only', 'No patient identifiers or clinical records are queried.'],
            ['No clinical side effects', 'Messages, assignments, notes, exports, and outcomes are simulated locally.'],
            ['Claims stay bounded', 'Pathways remain educational and expose evidence/validation status.'],
          ].map(([title, detail]) => <div key={title} className="rounded-xl bg-slate-50 p-4"><h3 className="font-bold text-slate-950">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p></div>)}
        </div>
      </section>
    </div>
  );
}
