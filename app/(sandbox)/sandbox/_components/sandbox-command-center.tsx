'use client';

import { useState } from 'react';
import { Activity, ArrowRight, BookOpenCheck, ClipboardCheck, HeartPulse, Network, PhoneCall, ShieldCheck, Users } from 'lucide-react';
import { SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import {
  getPopulationDayEvents,
  POPULATION_SIZES,
  TRACK_SHORT_LABELS,
  type PopulationDayResult,
  type PopulationEvent,
  type PopulationSize,
} from '@/lib/sandbox/population';
import type { AiOutreachRun, SandboxSectionId, SandboxTaskState } from '@/lib/sandbox/types';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { Button } from '@/components/ui/button';
import { SandboxPopulationReplay } from './sandbox-population-replay';
import { MetricCard, SectionHeading, SyntheticBanner } from './sandbox-ui';

const ICONS = [Activity, PhoneCall, ClipboardCheck, HeartPulse, BookOpenCheck, Network, Users, ShieldCheck];
const numberFormat = new Intl.NumberFormat('en-US');

export function SandboxCommandCenter({ taskStates, visitedSections, dayIndex, populationSize, populationReviewedIds, sentWorkItemIds, onPopulationSize, onMarkPopulationReviewed, onSendToDailyLoop, onNavigate, automatedCallsCount }: {
  taskStates: Record<string, SandboxTaskState>;
  visitedSections: SandboxSectionId[];
  dayIndex: number;
  populationSize: PopulationSize;
  populationReviewedIds: string[];
  sentWorkItemIds: string[];
  onPopulationSize: (size: PopulationSize) => void;
  onMarkPopulationReviewed: (reviewedId: string) => void;
  onSendToDailyLoop: (run: AiOutreachRun) => void;
  onNavigate: (section: SandboxSectionId) => void;
  automatedCallsCount: number;
}) {
  const closed = Object.values(taskStates).filter((state) => state.status === 'closed').length;
  const actioned = Object.values(taskStates).filter((state) => ['actioned', 'awaiting', 'closed'].includes(state.status)).length;
  const nextSection = SANDBOX_SECTIONS.find((section) => !visitedSections.includes(section.id) && section.id !== 'command')?.id ?? 'daily-loop';

  const [result, setResult] = useState<PopulationDayResult | null>(null);

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

          <SandboxPopulationReplay size={populationSize} dayIndex={dayIndex} onDone={setResult} />
        </div>
      </section>

      <SyntheticBanner>
        Names, events, values, messages, access relationships, and outcomes are fictional. Interaction state stays in this browser and never writes to clinical tables.
      </SyntheticBanner>

      {result && (
        <ReviewQueueSection
          result={result}
          populationSize={populationSize}
          dayIndex={dayIndex}
          populationReviewedIds={populationReviewedIds}
          sentWorkItemIds={sentWorkItemIds}
          onMarkPopulationReviewed={onMarkPopulationReviewed}
          onSendToDailyLoop={onSendToDailyLoop}
          onNavigate={onNavigate}
        />
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

const QUEUE_CATEGORY_RANK: Record<string, number> = { critical: 0, warning: 1, no_answer: 2 };
const UNREACHABLE_POLICY =
  'Documented monitoring-gap policy: high-risk patient with no successful contact after the automated retry — the downtime contact plan (alternate numbers, caregiver, CHW visit) is due today.';

function isReviewQueueEvent(event: PopulationEvent): boolean {
  return event.category === 'critical' || event.category === 'warning'
    || (event.category === 'no_answer' && event.riskTier === 'High');
}

/** The clinician's working list: every entry expandable into the values and the registered rule behind it. */
function ReviewQueueSection({ result, populationSize, dayIndex, populationReviewedIds, sentWorkItemIds, onMarkPopulationReviewed, onSendToDailyLoop, onNavigate }: {
  result: PopulationDayResult;
  populationSize: PopulationSize;
  dayIndex: number;
  populationReviewedIds: string[];
  sentWorkItemIds: string[];
  onMarkPopulationReviewed: (reviewedId: string) => void;
  onSendToDailyLoop: (run: AiOutreachRun) => void;
  onNavigate: (section: SandboxSectionId) => void;
}) {
  const [expandedOrdinal, setExpandedOrdinal] = useState<number | null>(null);
  const queue = getPopulationDayEvents(populationSize, dayIndex)
    .filter(isReviewQueueEvent)
    .sort((a, b) => QUEUE_CATEGORY_RANK[a.category] - QUEUE_CATEGORY_RANK[b.category])
    .slice(0, 12);
  if (queue.length === 0) return null;

  return (
    <section className="rounded-2xl border bg-white p-5" aria-label="Today's review queue" data-testid="population-exceptions">
      <SectionHeading
        eyebrow="What reaches the human"
        title={`Today's review queue (${numberFormat.format(result.counts.reviewQueue)} of ${numberFormat.format(result.counts.total)})`}
        description="Every entry below was put here by a registered clinical rule or a documented monitoring-gap policy — never by AI. Names and values are synthetic. Open one to work it."
      />
      <ul className="mt-4 grid gap-2 md:grid-cols-2">
        {queue.map((event) => {
          const reviewedId = `pop-${event.ordinal}-d${dayIndex}`;
          const runId = `ai-run-pop${event.ordinal}d${dayIndex}`;
          const reviewed = populationReviewedIds.includes(reviewedId);
          const sent = sentWorkItemIds.includes(runId);
          const expanded = expandedOrdinal === event.ordinal;
          const rule = event.ruleIds?.[0]
            ? (RED_FLAG_CRITERIA as Record<string, { message: string; action: string }>)[event.ruleIds[0]]
            : undefined;
          return (
            <li key={event.ordinal} className="rounded-xl border border-slate-200 bg-slate-50 text-sm">
              <button
                type="button"
                className="w-full p-3 text-left"
                aria-expanded={expanded}
                data-testid={`queue-entry-${event.ordinal}`}
                onClick={() => setExpandedOrdinal(expanded ? null : event.ordinal)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-950">{event.name} · {event.age}{reviewed && <span className="ml-2 text-xs font-semibold text-emerald-700">Reviewed ✓</span>}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${event.category === 'critical' ? 'bg-red-100 text-red-800' : event.category === 'warning' ? 'bg-amber-100 text-amber-900' : 'bg-slate-200 text-slate-700'}`}>
                    {event.category === 'no_answer' ? 'unreachable' : event.category}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{event.state} · {TRACK_SHORT_LABELS[event.track]} · {event.riskTier} risk</p>
                <p className="mt-1.5 leading-5 text-slate-700">{event.detail}</p>
              </button>
              {expanded && (
                <div className="border-t border-slate-200 p-3" data-testid={`queue-detail-${event.ordinal}`}>
                  {event.values && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700 sm:grid-cols-4">
                      <div><dt className="text-slate-500">Weight</dt><dd className="font-bold">{event.values.weightLbs} lb{typeof event.weightDelta === 'number' && event.weightDelta !== 0 && <span className={event.weightDelta > 0 ? 'text-red-700' : 'text-emerald-700'}> ({event.weightDelta > 0 ? '+' : ''}{event.weightDelta})</span>}</dd></div>
                      <div><dt className="text-slate-500">SBP</dt><dd className="font-bold">{event.values.sbp} mmHg</dd></div>
                      <div><dt className="text-slate-500">SpO2</dt><dd className="font-bold">{event.values.spo2}%</dd></div>
                      <div><dt className="text-slate-500">Dyspnea</dt><dd className="font-bold">{event.values.dyspnea}/3</dd></div>
                    </dl>
                  )}
                  {event.weightHistory && event.values && (
                    <WeightSparkline history={event.weightHistory} today={event.values.weightLbs} />
                  )}
                  <p className="mt-2 rounded-lg bg-white p-2 text-xs leading-5 text-slate-600">
                    {rule
                      ? <>Registered rule <span className="font-mono font-semibold">{event.ruleIds![0]}</span>: {rule.message} — {rule.action}</>
                      : UNREACHABLE_POLICY}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm" variant="outline" className="min-h-11"
                      disabled={reviewed}
                      data-testid={`queue-review-${event.ordinal}`}
                      onClick={() => onMarkPopulationReviewed(reviewedId)}
                    >
                      {reviewed ? 'Reviewed ✓' : 'Mark reviewed'}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="min-h-11"
                      disabled={sent}
                      data-testid={`queue-send-${event.ordinal}`}
                      onClick={() => onSendToDailyLoop({
                        id: runId,
                        patientName: event.name,
                        disposition: event.category === 'no_answer' ? 'no_answer' : 'escalated',
                        redFlagIds: event.ruleIds ?? [],
                        atLabel: 'Overnight round',
                        dayIndex,
                        note: event.category === 'no_answer' ? event.detail : undefined,
                      })}
                    >
                      {sent ? 'In Daily Loop ✓' : 'Send to Daily Loop'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => onNavigate('daily-loop')}>Open the Daily Loop →</Button>
        <Button variant="outline" className="min-h-11" onClick={() => onNavigate('outreach')}>See how one call is handled →</Button>
        <Button variant="outline" className="min-h-11" onClick={() => onNavigate('copilot')}>Ask the copilot about the day →</Button>
      </div>
    </section>
  );
}

/** Seven prior weights plus today, most recent last; today's point highlighted. */
function WeightSparkline({ history, today }: { history: number[]; today: number }) {
  const points = [...history].reverse().concat(today);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 0.5);
  const coords = points.map((value, index) => ({
    x: 4 + (index * 112) / (points.length - 1),
    y: 24 - ((value - min) / span) * 20,
  }));
  return (
    <svg viewBox="0 0 120 28" className="mt-2 h-7 w-32" role="img" aria-label={`Weight trend: ${points[0]} to ${today} pounds over 8 days`}>
      <polyline
        points={coords.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none" stroke="#64748b" strokeWidth="1.5"
      />
      <circle cx={coords.at(-1)!.x} cy={coords.at(-1)!.y} r="2.5" fill="#dc2626" />
    </svg>
  );
}
