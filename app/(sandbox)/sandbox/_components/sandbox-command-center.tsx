'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, BookOpenCheck, ClipboardCheck, HeartPulse, Network, PhoneCall, Play, ShieldCheck, Users } from 'lucide-react';
import { SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import {
  POPULATION_SIZES,
  simulatePopulationDay,
  TRACK_SHORT_LABELS,
  type PopulationDayResult,
  type PopulationSize,
} from '@/lib/sandbox/population';
import type { SandboxSectionId, SandboxTaskState } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { MetricCard, SectionHeading, SyntheticBanner } from './sandbox-ui';

const ICONS = [Activity, PhoneCall, ClipboardCheck, HeartPulse, BookOpenCheck, Network, Users, ShieldCheck];
const COUNT_UP_MS = 1400;
const numberFormat = new Intl.NumberFormat('en-US');

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function SandboxCommandCenter({ taskStates, visitedSections, dayIndex, populationSize, onPopulationSize, onNavigate, automatedCallsCount }: {
  taskStates: Record<string, SandboxTaskState>;
  visitedSections: SandboxSectionId[];
  dayIndex: number;
  populationSize: PopulationSize;
  onPopulationSize: (size: PopulationSize) => void;
  onNavigate: (section: SandboxSectionId) => void;
  automatedCallsCount: number;
}) {
  const closed = Object.values(taskStates).filter((state) => state.status === 'closed').length;
  const actioned = Object.values(taskStates).filter((state) => ['actioned', 'awaiting', 'closed'].includes(state.status)).length;
  const nextSection = SANDBOX_SECTIONS.find((section) => !visitedSections.includes(section.id) && section.id !== 'command')?.id ?? 'daily-loop';

  const [scene, setScene] = useState<'idle' | 'running' | 'done'>('idle');
  const [result, setResult] = useState<PopulationDayResult | null>(null);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);

  // A different day or population invalidates the round on screen.
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setScene('idle');
    setResult(null);
    setProgress(0);
  }, [dayIndex, populationSize]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  function runRound() {
    if (scene === 'running') return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setScene('running');
    setProgress(0);
    // Compute on the next frame so the "Running…" state paints first; the
    // simulation itself is deterministic and effectively instant.
    rafRef.current = requestAnimationFrame(() => {
      const computed = simulatePopulationDay(populationSize, dayIndex);
      setResult(computed);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setProgress(1);
        setScene('done');
        return;
      }
      const startedAt = performance.now();
      const tick = (timestamp: number) => {
        const linear = Math.min((timestamp - startedAt) / COUNT_UP_MS, 1);
        setProgress(easeOut(linear));
        if (linear < 1) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setScene('done');
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    });
  }

  const animated = (value: number) => numberFormat.format(Math.round(value * progress));
  const counts = result?.counts ?? null;

  return (
    <div className="space-y-8" data-testid="sandbox-command-center">
      <section className="overflow-hidden rounded-3xl bg-slate-950 px-5 py-8 text-white sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.9fr)] lg:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Full synthetic product tour</p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">One clinician. Thousands of patients. Every decision by registered rules.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              HEARTLAND automates the repetitive part of daily heart-failure monitoring over a
              synthetic rural population: the registered clinical rules process every check-in,
              retry the unreachable, route adherence gaps — and hand the clinician only the
              exceptions. Run the round and watch.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-white/20 p-1" role="group" aria-label="Synthetic population size">
                {POPULATION_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    data-testid={`population-size-${size}`}
                    aria-pressed={populationSize === size}
                    onClick={() => onPopulationSize(size)}
                    className={`min-h-11 rounded-md px-3 text-sm font-semibold transition ${populationSize === size ? 'bg-white text-slate-950' : 'text-slate-200 hover:bg-white/10'}`}
                  >
                    {numberFormat.format(size)}
                  </button>
                ))}
              </div>
              <Button className="min-h-12 bg-blue-600 px-5 font-bold text-white hover:bg-blue-500" onClick={runRound} disabled={scene === 'running'} data-testid="population-run">
                <Play className="mr-2 size-4" /> {scene === 'running' ? 'Running the overnight round…' : 'Run the overnight round'}
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="ghost" className="min-h-11 border border-white/25 text-white hover:bg-white/10 hover:text-white" onClick={() => onNavigate(nextSection)}>
                Continue guided tour <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button variant="ghost" className="min-h-11 border border-white/25 text-white hover:bg-white/10 hover:text-white" data-testid="sandbox-open-patient-360" onClick={() => onNavigate('patient-360')}>
                Meet the 3 patients you follow closely
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/5 p-5" data-testid="population-funnel">
            <p className="text-sm font-semibold text-blue-200">Overnight round · Day {dayIndex + 1} of 5</p>
            <div aria-hidden={scene === 'running'}>
              <p className="mt-3 text-4xl font-bold tabular-nums sm:text-5xl">{counts ? animated(counts.total) : '—'}</p>
              <p className="text-sm text-slate-300">synthetic check-ins processed by the registered rules</p>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Routine — auto-documented</dt><dd className="font-bold tabular-nums">{counts ? animated(counts.routine) : '—'}</dd></div>
                <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Answered on automated retry</dt><dd className="font-bold tabular-nums">{counts ? animated(counts.retriedResolved) : '—'}</dd></div>
                <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Adherence gaps → pharmacist workflow</dt><dd className="font-bold tabular-nums">{counts ? animated(counts.adherenceLapse) : '—'}</dd></div>
                <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Unreachable — retry cadence continues</dt><dd className="font-bold tabular-nums">{counts ? animated(counts.unresolvedNoAnswer) : '—'}</dd></div>
                <div className="flex items-baseline justify-between gap-3 rounded-lg bg-amber-400/15 px-2 py-1.5"><dt className="font-semibold text-amber-200">Review queue — for the clinician</dt><dd className="text-lg font-bold tabular-nums text-amber-100">{counts ? animated(counts.reviewQueue) : '—'}</dd></div>
              </dl>
              {counts && scene === 'done' && (
                <>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${counts.automatedPct}%` }} />
                  </div>
                  <p className="mt-2 text-sm font-semibold text-emerald-300" data-testid="population-claim">
                    {numberFormat.format(counts.reviewQueue)} of {numberFormat.format(counts.total)} synthetic
                    check-ins reached the clinician review queue — {counts.automatedPct}% resolved by the
                    registered rules.
                  </p>
                </>
              )}
              {scene === 'idle' && (
                <p className="mt-4 text-xs text-slate-400">Deterministic simulation — same numbers on every device, all decisions by the registered clinical rules, no AI in the loop.</p>
              )}
            </div>
            <p role="status" aria-live="polite" className="sr-only">
              {scene === 'done' && counts
                ? `Overnight round complete: ${counts.total} synthetic check-ins processed, ${counts.reviewQueue} reached the clinician review queue, ${counts.automatedPct} percent resolved by the registered rules.`
                : ''}
            </p>
            <p className="mt-3 text-[11px] leading-4 text-slate-400" data-testid="population-disclaimer">
              Illustrative workflow demonstration on synthetic data — not a clinical outcome or
              staffing claim.
            </p>
          </div>
        </div>
      </section>

      <SyntheticBanner>
        Names, events, values, messages, access relationships, and outcomes are fictional. Interaction state stays in this browser and never writes to clinical tables.
      </SyntheticBanner>

      {scene === 'done' && result && result.exceptions.length > 0 && (
        <section className="rounded-2xl border bg-white p-5" aria-label="Today's review queue" data-testid="population-exceptions">
          <SectionHeading
            eyebrow="What reaches the human"
            title={`Today's review queue (${numberFormat.format(result.counts.reviewQueue)} of ${numberFormat.format(result.counts.total)})`}
            description="Every entry below was put here by a registered clinical rule or a documented monitoring-gap policy — never by AI. Names and values are synthetic."
          />
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {result.exceptions.slice(0, 12).map((exception) => (
              <li key={`${exception.name}-${exception.reason}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-950">{exception.name} · {exception.age}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${exception.category === 'critical' ? 'bg-red-100 text-red-800' : exception.category === 'warning' ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-700'}`}>
                    {exception.category === 'no_answer' ? 'unreachable' : exception.category}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{exception.state} · {TRACK_SHORT_LABELS[exception.track]} · {exception.riskTier} risk</p>
                <p className="mt-1.5 leading-5 text-slate-700">{exception.reason}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={() => onNavigate('outreach')}>See how one call is handled →</Button>
            <Button variant="outline" className="min-h-11" onClick={() => onNavigate('copilot')}>Ask the copilot about the day →</Button>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Sandbox product metrics">
        <MetricCard label="Close-follow patients" value={SANDBOX_PATIENTS.length} detail="The tour zooms into three synthetic cases." tone="blue" />
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
                  <span className="flex items-center gap-2">
                    {section.id === 'copilot' && !visited && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">NEW</span>}
                    <span className={visited ? 'text-xs font-semibold text-emerald-700' : 'text-xs font-semibold text-slate-600'}>{visited ? 'Explored' : 'Open'}</span>
                  </span>
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
