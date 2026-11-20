import { OUTREACH_TRANSCRIPTS } from '@/lib/sandbox-ai/fixtures';
import { simulatePopulationDay, type PopulationSize } from '@/lib/sandbox/population';

const numberFormat = new Intl.NumberFormat('en-US');

const LAYERS = [
  { label: 'Synthetic input', detail: 'fictional values only' },
  { label: 'AI language layer', detail: 'converses and extracts' },
  { label: 'Registered rules', detail: 'set disposition' },
  { label: 'Voice interface', detail: 'optional narration' },
  { label: 'Human review', detail: 'required before real use' },
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
    },
    {
      label: 'Separate',
      value: `${population.counts.automatedPct}%`,
      detail: 'outside the review queue',
    },
    {
      label: 'Route',
      value: numberFormat.format(population.counts.reviewQueue),
      detail: 'exceptions for review',
    },
    {
      label: 'Clarify',
      value: 'AI',
      detail: 'conversation + extraction',
    },
    {
      label: 'Re-evaluate',
      value: 'Rule ID',
      detail: 'same registered thresholds',
    },
    {
      label: 'Review required',
      value: 'Human',
      detail: 'verify before follow-through',
    },
  ] as const;

  return (
    <section
      className="panel overflow-hidden [overflow-wrap:anywhere]"
      aria-labelledby="ai-evidence-flow-title"
      data-testid="ai-evidence-flow"
    >
      <div className="border-b border-border px-4 py-5 sm:px-6">
        <p className="section-kicker">How the automation works</p>
        <h2 id="ai-evidence-flow-title" className="section-title mt-1">From check-in to human review</h2>
        <p className="mt-2 max-w-3xl text-base leading-7 text-muted-foreground">
          AI handles language. Registered rules and monitoring-gap policies determine simulated routing. Real use would require human review and authorization; this demonstration does not deliver care.
        </p>
        <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-x-5 gap-y-3" aria-label="Automation layer legend">
          {LAYERS.map(({ label, detail }) => (
            <div key={label} className="min-w-0 border-t border-border pt-2">
              <dt className="text-sm font-semibold text-foreground">{label}</dt>
              <dd className="text-sm leading-5 text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="p-3 sm:p-6">
        <p className="mb-3 text-base leading-7 text-slate-700">
          Steps 1–3 describe the chosen population scenario. Steps 4–6 illustrate the fixed transcript example below, not a completed workflow for every check-in.
        </p>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Automation evidence pipeline">
          {steps.map(({ label, value, detail }, index) => (
            <li key={label} className="min-w-0 rounded-lg border border-border bg-background p-4">
                <p className="mb-3 text-xs font-semibold text-slate-600">{index < 3 ? 'Population scenario' : 'Fixed example'}</p>
                <p className="mt-3 text-sm font-bold text-slate-700">{index + 1} · {label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-950">{value}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{detail}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
          {numberFormat.format(population.counts.unresolvedNoAnswer)} unanswered after simulated retry, including High-risk cases in the queue.
          {' '}These counts overlap. Outside the queue does not mean resolved; answering a retry does not establish a normal classification.
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200" data-testid="decision-receipt">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Decision receipt · worked example</p>
              <p className="mt-0.5 text-sm font-bold text-slate-950">Maria Santos · synthetic outreach</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">Fixed example, not a member of the generated population. Changing population or day does not change this receipt.</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">
              Human review required
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3">
            <div className="border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                1 · Source transcript
              </p>
              <blockquote className="mt-3 border-l-2 border-slate-300 pl-3 text-sm leading-6 text-slate-700">
                “{sourceExcerpt}”
              </blockquote>
              <p className="mt-3 text-xs font-semibold text-slate-500">Synthetic fixture · source text remains visible for verification</p>
            </div>

            <div className="border-b border-slate-200 bg-background p-4 lg:border-b-0 lg:border-r">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-violet-800">
                2 · AI extraction
              </p>
              <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Weight</dt><dd className="font-bold text-slate-950">{receipt.extraction.weightLbs ?? 'Unknown'} lb</dd></div>
                <div><dt className="text-xs text-slate-500">Dyspnea</dt><dd className="font-bold text-slate-950">{formatSeverity(receipt.extraction.dyspnea)}</dd></div>
                <div><dt className="text-xs text-slate-500">Edema</dt><dd className="font-bold text-slate-950">{formatSeverity(receipt.extraction.edema)}</dd></div>
                <div><dt className="text-xs text-slate-500">Orthopnea</dt><dd className="font-bold text-slate-950">{receipt.extraction.orthopnea === null ? 'Unknown' : receipt.extraction.orthopnea ? 'Yes' : 'No'}</dd></div>
                <div><dt className="text-xs text-slate-500">Adherence</dt><dd className="font-bold capitalize text-slate-950">{receipt.extraction.adherence ?? 'Unknown'}</dd></div>
                <div><dt className="text-xs text-slate-500">Chest pain/syncope</dt><dd className="font-bold text-slate-950">{receipt.extraction.chestPainOrSyncope === null ? 'Unknown' : receipt.extraction.chestPainOrSyncope ? 'Yes' : 'No'}</dd></div>
              </dl>
              <p className="mt-3 text-xs font-semibold text-violet-800">Structured, not trusted as the final disposition</p>
            </div>

            <div className="bg-background p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-800">
                3 · Rule + human action
              </p>
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Registered rule</p>
                  <p className="font-bold text-slate-950">{primaryRule?.id ?? 'No rule triggered'}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{primaryRule?.message ?? 'Routine path'}</p>
                </div>
                <div className="flex items-start gap-2 rounded-lg bg-white/80 p-3">
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
                  <div>
                    <p className="text-xs text-slate-500">Human decision</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-800">Verify the source, choose the follow-through, and document the outcome.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-500">
          Technical workflow demonstration on synthetic fixtures. The receipt explains provenance; it is not clinical validation or autonomous decision-making.
        </p>
      </div>
    </section>
  );
}
