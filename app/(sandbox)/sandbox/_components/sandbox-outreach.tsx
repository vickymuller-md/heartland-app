'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, PhoneCall, Wand2 } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import { OUTREACH_TRANSCRIPTS, type SimulatedCallTranscript } from '@/lib/sandbox-ai/fixtures';
import { draftSbarFromCheckIn } from '@/lib/sandbox-ai/sbar';
import type { CheckInExtraction } from '@/lib/sandbox-ai/types';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { AiOutreachRun, SandboxPatient } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { MetricCard, OutreachDispositionPill, SectionHeading, SyntheticBanner } from './sandbox-ui';

function trackAiEvent(eventName: ProductEventInput['eventName']) {
  void trackProductEvent({ eventName, area: 'sandbox', ...getPublicDisseminationContext() });
}

const EXTRACTION_ROWS: Array<{ key: keyof CheckInExtraction; label: string; render: (value: never) => string }> = [
  { key: 'weightLbs', label: 'Weight', render: (value: number) => `${value} lbs` },
  { key: 'dyspnea', label: 'Breathing (0-3)', render: (value: number) => `${value}` },
  { key: 'edema', label: 'Swelling (0-3)', render: (value: number) => `${value}` },
  { key: 'orthopnea', label: 'Orthopnea', render: (value: boolean) => (value ? 'Yes' : 'No') },
  { key: 'fatigue', label: 'Fatigue (0-3)', render: (value: number) => `${value}` },
  { key: 'adherence', label: 'Medications', render: (value: string) => value.replace('_', ' ') },
  { key: 'sbp', label: 'Systolic BP', render: (value: number) => `${value} mmHg` },
  { key: 'spo2', label: 'SpO2', render: (value: number) => `${value}%` },
];

function ExtractionPanel({ extraction }: { extraction: CheckInExtraction }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Structured data captured by the AI layer</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {EXTRACTION_ROWS.map((row) => {
          const value = extraction[row.key];
          return (
            <div key={row.key} className="flex flex-col">
              <dt className="text-xs text-slate-500">{row.label}</dt>
              <dd className="font-semibold text-slate-900">
                {value === null ? 'not established' : row.render(value as never)}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function SbarDraft({ patient, extraction }: { patient: SandboxPatient; extraction: CheckInExtraction }) {
  const draft = useMemo(() => draftSbarFromCheckIn(patient, extraction), [patient, extraction]);
  const [fields, setFields] = useState(draft);
  const [polishStatus, setPolishStatus] = useState<'idle' | 'busy' | 'proposed' | 'accepted' | 'rejected' | 'unavailable'>('idle');
  const [polishProposal, setPolishProposal] = useState<{
    before: Pick<typeof draft, 'situation' | 'background'>;
    after: Pick<typeof draft, 'situation' | 'background'>;
  } | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<Pick<typeof draft, 'situation' | 'background'> | null>(null);
  const sections = [
    ['Situation', 'situation'], ['Background', 'background'],
    ['Assessment', 'assessment'], ['Recommendation', 'recommendation'],
  ] as const;

  async function polish() {
    if (polishStatus === 'busy' || polishProposal) return;
    const before = { situation: fields.situation, background: fields.background };
    setPolishProposal(null);
    setUndoSnapshot(null);
    setPolishStatus('busy');
    const result = await requestAssist({
      kind: 'sbar_polish',
      input: {
        patientName: patient.name,
        sbar: {
          situation: fields.situation,
          background: fields.background,
          assessment: 'Provider-owned field excluded from AI wording request.',
          recommendation: 'Provider-owned field excluded from AI wording request.',
        },
      },
      anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
    });
    if (result?.kind === 'sbar_polish') {
      setPolishProposal({
        before,
        after: { situation: result.situation, background: result.background },
      });
      setPolishStatus('proposed');
      return;
    }
    setPolishStatus('unavailable');
  }

  function acceptPolish() {
    if (!polishProposal) return;
    setUndoSnapshot({
      situation: fields.situation,
      background: fields.background,
    });
    setFields((current) => ({
      ...current,
      situation: polishProposal.after.situation,
      background: polishProposal.after.background,
    }));
    setPolishProposal(null);
    setPolishStatus('accepted');
  }

  function rejectPolish() {
    setPolishProposal(null);
    setPolishStatus('rejected');
  }

  function undoPolish() {
    if (!undoSnapshot) return;
    setFields((current) => ({
      ...current,
      situation: undoSnapshot.situation,
      background: undoSnapshot.background,
    }));
    setUndoSnapshot(null);
    setPolishStatus('idle');
  }

  function updateField(key: (typeof sections)[number][1], value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    if (key === 'situation' || key === 'background') {
      setPolishProposal(null);
      setUndoSnapshot(null);
      setPolishStatus('idle');
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4" data-testid="sandbox-sbar-draft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-slate-950">SBAR handoff draft</p>
        <Button size="sm" variant="outline" disabled={polishStatus === 'busy' || polishProposal !== null} onClick={() => void polish()} data-testid="sbar-polish">
          <Wand2 className="mr-1 size-4" /> {polishStatus === 'busy' ? 'Polishing…' : 'Polish wording with AI'}
        </Button>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        Situation and Background are drafted from the structured check-in data shown above — verify
        against the source values. Assessment and Recommendation always stay with the provider.
      </p>
      <p className="mt-2 text-[11px] font-semibold leading-4 text-amber-800">
        Synthetic draft only — do not paste real patient, personal, or health information. AI polish sends Situation and Background only; Assessment and Recommendation remain browser-local.
      </p>
      {polishStatus === 'proposed' && polishProposal && (
        <p className="mt-2 rounded-lg border border-blue-300 bg-white p-2 text-[11px] leading-4 text-slate-700" data-testid="sbar-polish-note">
          AI wording proposal — review before use. Only Situation and Background are proposed;
          the current draft stays unchanged until you accept.
        </p>
      )}
      {polishStatus === 'accepted' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-white p-2 text-[11px] leading-4 text-slate-700" data-testid="sbar-polish-accepted">
          <span>AI wording accepted for Situation and Background only. Assessment and Recommendation stayed unchanged.</span>
          <Button size="sm" variant="outline" onClick={undoPolish}>Undo accepted wording</Button>
        </div>
      )}
      {polishStatus === 'rejected' && (
        <p className="mt-2 text-[11px] text-slate-600" data-testid="sbar-polish-rejected">Proposal rejected — the draft is unchanged.</p>
      )}
      {polishStatus === 'unavailable' && (
        <p className="mt-2 text-[11px] text-slate-500">Polishing is unavailable right now — the deterministic draft below is unchanged.</p>
      )}
      {polishProposal && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-white p-3" data-testid="sbar-polish-proposal">
          <p className="text-xs font-bold text-slate-900">Compare current draft with AI proposal</p>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">
            {(['situation', 'background'] as const).map((key) => (
              <div key={key} className="rounded-lg border border-slate-200 p-3" data-testid={`sbar-polish-diff-${key}`}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{key}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Current</p>
                    <p className="mt-1 text-xs leading-5 text-slate-700">{polishProposal.before[key]}</p>
                  </div>
                  <div className="rounded-md bg-blue-50 p-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Proposed</p>
                    <p className="mt-1 text-xs leading-5 text-blue-950">{polishProposal.after[key]}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={acceptPolish}>Accept proposal</Button>
            <Button size="sm" variant="outline" onClick={rejectPolish}>Reject proposal</Button>
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {sections.map(([label, key]) => (
          <label key={key} className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
            {label}
            <textarea
              value={fields[key]}
              maxLength={1200}
              disabled={polishStatus === 'busy' && (key === 'situation' || key === 'background')}
              onChange={(event) => updateField(key, event.target.value)}
              rows={4}
              className="rounded-lg border border-slate-300 bg-white p-2 font-normal text-slate-900"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function CallCard({ transcript }: { transcript: SimulatedCallTranscript }) {
  const [expanded, setExpanded] = useState(false);
  const [showSbar, setShowSbar] = useState(false);
  const patient = transcript.patientId
    ? SANDBOX_PATIENTS.find((entry) => entry.id === transcript.patientId) ?? null
    : null;

  return (
    <article className="rounded-2xl border bg-white p-5 shadow-sm" data-testid={`outreach-call-${transcript.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-lg font-bold text-slate-950">{transcript.patientName}</h3>
        <OutreachDispositionPill disposition={transcript.disposition} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{transcript.placedLabel} · Automated voice simulation</p>

      {transcript.redFlags.length > 0 && (
        <ul className="mt-3 space-y-1">
          {transcript.redFlags.map((flag) => (
            <li key={flag.id} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
              <strong>{flag.message}</strong> — {flag.action}. <span className="text-amber-800">Rule: {flag.id}</span>
            </li>
          ))}
        </ul>
      )}
      {transcript.note && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">{transcript.note}</p>}

      {transcript.audioSrc && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3" data-testid={`outreach-audio-${transcript.id}`}>
          <audio
            controls
            preload="none"
            src={transcript.audioSrc}
            className="h-9 w-full"
            aria-label={`Synthetic audio simulation of the call with ${transcript.patientName}`}
          />
          <p className="mt-1 text-[11px] leading-4 text-slate-600">
            Synthetic audio simulation (AI-generated voices) — no real call is placed. The transcript below is the source of record.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" onClick={() => setExpanded((current) => !current)}>
          {expanded ? <ChevronUp className="mr-1 size-4" /> : <ChevronDown className="mr-1 size-4" />}
          {expanded ? 'Hide transcript' : 'View transcript'}
        </Button>
        {patient && transcript.disposition !== 'no_answer' && (
          <Button variant="outline" className="min-h-11" onClick={() => setShowSbar((current) => !current)}>
            <FileText className="mr-1 size-4" /> {showSbar ? 'Hide SBAR draft' : 'Draft SBAR handoff'}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 p-3" aria-label={`Transcript of the simulated call with ${transcript.patientName}`}>
          {transcript.turns.map((turn, index) => (
            <p key={index} className={turn.speaker === 'assistant'
              ? 'mr-8 rounded-lg rounded-bl-none bg-slate-100 p-2.5 text-xs leading-5 text-slate-900'
              : 'ml-8 rounded-lg rounded-br-none bg-blue-100 p-2.5 text-xs leading-5 text-blue-950'}>
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {turn.speaker === 'assistant' ? 'Automated assistant' : 'Synthetic patient'}
              </span>
              {turn.text}
            </p>
          ))}
        </div>
      )}

      {expanded && <div className="mt-3"><ExtractionPanel extraction={transcript.extraction} /></div>}
      {showSbar && patient && <div className="mt-3"><SbarDraft patient={patient} extraction={transcript.extraction} /></div>}
    </article>
  );
}

export function SandboxOutreach({ liveCalls, runs, onLiveCall }: {
  liveCalls: SimulatedCallTranscript[];
  runs: AiOutreachRun[];
  onLiveCall: (transcript: SimulatedCallTranscript) => void;
}) {
  const [running, setRunning] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const allCalls = [...liveCalls, ...OUTREACH_TRANSCRIPTS];
  const escalations = allCalls.filter((call) => call.disposition === 'escalated' || call.disposition === 'emergency').length;
  const priorRuns = runs.filter((run) => !liveCalls.some((call) => call.id === run.id));

  async function runSimulatedCall() {
    if (running) return;
    setRunning(true);
    setUnavailable(false);
    try {
      const response = await fetch('/api/sandbox-ai/simulate-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousSessionId: getPublicDisseminationContext().anonymousSessionId }),
      });
      if (!response.ok && response.status !== 429) throw new Error('request failed');
      const body = (await response.json()) as { fallback?: boolean; transcript?: SimulatedCallTranscript };
      if (body.fallback || !body.transcript) {
        setUnavailable(true);
        return;
      }
      onLiveCall(body.transcript);
      trackAiEvent('ai_call_sim_run');
      if (body.transcript.disposition === 'escalated' || body.transcript.disposition === 'emergency') {
        trackAiEvent('ai_escalation_demonstrated');
      }
    } catch {
      setUnavailable(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-7" data-testid="sandbox-outreach">
      <SectionHeading
        eyebrow="Provider workspace"
        title="Automated Outreach (demonstration)"
        description="Routine daily check-in calls run automatically at scale; the AI layer structures each conversation while registered clinical rules route every call to routine monitoring or human review. Silence and no-answers escalate — they never close a loop."
        action={
          <Button className="min-h-11" disabled={running} onClick={() => void runSimulatedCall()} data-testid="run-simulated-call">
            <PhoneCall className="mr-2 size-4" /> {running ? 'Simulating…' : 'Run a new simulated call'}
          </Button>
        }
      />

      <SyntheticBanner>
        Calls below are simulations on synthetic personas — no real call is ever placed. Priority
        set by registered clinical rules · conversation structured by AI.
      </SyntheticBanner>

      {unavailable && (
        <p className="rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm text-slate-700" data-testid="simulate-unavailable">
          Live simulation is unavailable right now (assistant disabled or usage cap reached). The
          pre-generated calls below demonstrate the same engine.
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Automated outreach synthetic metrics">
        <MetricCard label="Calls demonstrated" value={allCalls.length} detail="Pre-generated fixtures plus live simulations." tone="blue" />
        <MetricCard label="Escalated to humans" value={escalations} detail="Routed by deterministic red-flag rules." tone="amber" />
        <MetricCard label="Routine" value={allCalls.filter((call) => call.disposition === 'routine').length} detail="Stay in the monitoring queue." tone="emerald" />
        <MetricCard label="No answer" value={allCalls.filter((call) => call.disposition === 'no_answer').length} detail="Always routed to human follow-up." tone="slate" />
      </section>

      <section className="space-y-4" aria-label="Simulated call transcripts">
        {allCalls.map((transcript) => <CallCard key={transcript.id} transcript={transcript} />)}
      </section>

      {priorRuns.length > 0 && (
        <section className="rounded-2xl border bg-white p-4" aria-label="Earlier simulated calls">
          <p className="text-sm font-bold text-slate-950">Simulated earlier in this browser</p>
          <p className="mt-1 text-xs text-slate-500">Transcripts are session-local and are not retained after leaving the page; dispositions were recorded.</p>
          <ul className="mt-2 space-y-2">
            {priorRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <span className="mr-auto font-semibold">{run.patientName}</span>
                <OutreachDispositionPill disposition={run.disposition} />
                <span className="text-xs text-slate-500">{run.atLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
