import {
  AudioLines,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Cog,
  FileInput,
  ListFilter,
  MessageSquareText,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { OUTREACH_TRANSCRIPTS } from '@/lib/sandbox-ai/fixtures';
import { simulatePopulationDay, type PopulationSize } from '@/lib/sandbox/population';

const numberFormat = new Intl.NumberFormat('en-US');

const LAYERS = [
  { label: 'Synthetic input', detail: 'fictional values only', icon: FileInput, tone: 'border-slate-200 bg-slate-50 text-slate-800' },
  { label: 'AI language layer', detail: 'converses and extracts', icon: Bot, tone: 'border-violet-200 bg-violet-50 text-violet-900' },
  { label: 'Registered rules', detail: 'set disposition', icon: Cog, tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  { label: 'Voice interface', detail: 'optional narration', icon: AudioLines, tone: 'border-blue-200 bg-blue-50 text-blue-900' },
  { label: 'Human review', detail: 'authorizes action', icon: UserRoundCheck, tone: 'border-amber-200 bg-amber-50 text-amber-950' },
] as const;

function formatSeverity(value: number | null) {
  if (value === null) return 'Unknown';
  return `${value}/3`;
}

export function SandboxAiEvidenceFlow({ populationSize, dayIndex }: {
  populationSize: PopulationSize;
  dayIndex: number;
}) {
  const population = simulatePopulationDay(populationSize, dayIndex);
  const receipt = OUTREACH_TRANSCRIPTS[0];
  const patientTurns = receipt.turns.filter((turn) => turn.speaker === 'patient');
  const sourceExcerpt = patientTurns.slice(2, 5).map((turn) => turn.text).join(' ');
  const primaryRule = receipt.redFlags[0];

  const steps = [
    {
      label: 'Collect',
      value: numberFormat.format(population.counts.total),
      detail: 'synthetic check-ins',
      icon: FileInput,
      tone: 'bg-slate-100 text-slate-800',
    },
    {
      label: 'Classify',
      value: `${population.counts.automatedPct}%`,
      detail: 'resolved by rules',
      icon: Cog,
      tone: 'bg-emerald-100 text-emerald-900',
    },
    {
      label: 'Route',
      value: numberFormat.format(population.counts.reviewQueue),
      detail: 'exceptions for review',
      icon: ListFilter,
      tone: 'bg-amber-100 text-amber-950',
    },
    {
      label: 'Clarify',
      value: 'AI',
      detail: 'conversation + extraction',
      icon: MessageSquareText,
      tone: 'bg-violet-100 text-violet-900',
    },
    {
      label: 'Re-evaluate',
      value: 'Rule ID',
      detail: 'same registered thresholds',
      icon: ShieldCheck,
      tone: 'bg-emerald-100 text-emerald-900',
    },
    {
      label: 'Close loop',
      value: 'Human',
      detail: 'reviews and documents',
      icon: ClipboardCheck,
      tone: 'bg-blue-100 text-blue-900',
    },
  ] as const;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
      aria-labelledby="ai-evidence-flow-title"
      data-testid="ai-evidence-flow"
    >
      <div className="border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">How the automation works</p>
            <h2 id="ai-evidence-flow-title" className="mt-2 text-2xl font-bold tracking-tight">See every handoff, not a black box</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              AI handles language. Registered rules set every simulated disposition. A person reviews the evidence and authorizes the next action.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label="Automation layer legend">
            {LAYERS.map(({ label, detail, icon: Icon, tone }) => (
              <div key={label} className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 ${tone}`}>
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-xs font-bold leading-4">{label}</span>
                  <span className="block text-[10px] leading-4 opacity-80">{detail}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr)_1.25rem)_minmax(0,1fr)]" aria-label="Automation evidence pipeline">
          {steps.map(({ label, value, detail, icon: Icon, tone }, index) => (
            <li key={label} className="contents">
              <div className="min-w-0 rounded-xl bg-slate-50 p-3 xl:col-span-1">
                <span className={`inline-flex size-8 items-center justify-center rounded-lg ${tone}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">{index + 1} · {label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p>
              </div>
              {index < steps.length - 1 && (
                <div className="hidden items-center justify-center text-slate-300 xl:flex" aria-hidden="true">
                  <ChevronRight className="size-5" />
                </div>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200" data-testid="decision-receipt">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Decision receipt · worked example</p>
              <p className="mt-0.5 text-sm font-bold text-slate-950">Maria Santos · synthetic outreach</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">
              <UserRoundCheck className="size-3.5" aria-hidden="true" /> Human review required
            </span>
          </div>

          <div className="grid lg:grid-cols-3">
            <div className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                <MessageSquareText className="size-4 text-slate-700" aria-hidden="true" /> 1 · Source transcript
              </p>
              <blockquote className="mt-3 border-l-2 border-slate-300 pl-3 text-sm leading-6 text-slate-700">
                “{sourceExcerpt}”
              </blockquote>
              <p className="mt-3 text-[11px] font-semibold text-slate-500">Synthetic fixture · source text remains visible for verification</p>
            </div>

            <div className="border-b border-slate-200 bg-violet-50/50 p-4 lg:border-b-0 lg:border-r">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-800">
                <Bot className="size-4" aria-hidden="true" /> 2 · AI extraction
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Weight</dt><dd className="font-bold text-slate-950">{receipt.extraction.weightLbs ?? 'Unknown'} lb</dd></div>
                <div><dt className="text-xs text-slate-500">Dyspnea</dt><dd className="font-bold text-slate-950">{formatSeverity(receipt.extraction.dyspnea)}</dd></div>
                <div><dt className="text-xs text-slate-500">Edema</dt><dd className="font-bold text-slate-950">{formatSeverity(receipt.extraction.edema)}</dd></div>
                <div><dt className="text-xs text-slate-500">Orthopnea</dt><dd className="font-bold text-slate-950">{receipt.extraction.orthopnea === null ? 'Unknown' : receipt.extraction.orthopnea ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-xs text-slate-500">Adherence</dt><dd className="font-bold capitalize text-slate-950">{receipt.extraction.adherence ?? 'Unknown'}</dd></div>
                <div><dt className="text-xs text-slate-500">Chest pain/syncope</dt><dd className="font-bold text-slate-950">{receipt.extraction.chestPainOrSyncope === null ? 'Unknown' : receipt.extraction.chestPainOrSyncope ? 'Yes' : 'No'}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] font-semibold text-violet-800">Structured, not trusted as the final disposition</p>
            </div>

            <div className="bg-emerald-50/40 p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
                <Cog className="size-4" aria-hidden="true" /> 3 · Rule + human action
              </p>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Registered rule</p>
                  <p className="font-bold text-slate-950">{primaryRule?.id ?? 'No rule triggered'}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{primaryRule?.message ?? 'Routine path'}</p>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-white/80 p-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-slate-500">Deterministic disposition</p>
                    <p className="font-bold capitalize text-slate-950">{receipt.disposition}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Rule-directed follow-up</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{primaryRule?.action ?? 'Review the source and document the outcome.'}</p>
                </div>
                <div className="flex items-start gap-2 border-t border-emerald-200 pt-3">
                  <UserRoundCheck className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-slate-500">Human decision</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">Verify the source, choose the follow-through, and document the outcome.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Technical workflow demonstration on synthetic fixtures. The receipt explains provenance; it is not clinical validation or autonomous decision-making.
        </p>
      </div>
    </section>
  );
}
