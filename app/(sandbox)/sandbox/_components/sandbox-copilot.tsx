'use client';

import { useRef, useState } from 'react';
import { LoaderCircle, MessageSquareText, PhoneCall, Play, Send, Square, Volume2 } from 'lucide-react';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import type { CopilotTraceEntry } from '@/lib/sandbox-ai/copilot';
import {
  SIMULATED_CALL_SCENARIOS,
  type OutreachWorkItem,
  type SimulatedCallTranscript,
} from '@/lib/sandbox-ai/fixtures';
import { SANDBOX_DAY_COUNT } from '@/lib/sandbox/day-selectors';
import type { PopulationSize } from '@/lib/sandbox/population';
import type { SandboxDayLogEntry, SandboxSectionId } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { ExplainRuleButton } from './explain-rule';
import { OutreachDispositionPill, SectionHeading, SyntheticBanner } from './sandbox-ui';
import { useAssistantAudioQueue } from './use-assistant-audio-queue';

interface ScenarioProgress {
  scenarioId: string;
  patientName: string;
  status: 'pending' | 'calling' | 'done' | 'failed';
  transcript?: SimulatedCallTranscript;
}

interface CopilotExchange {
  question: string;
  answer: string;
  toolTrace: CopilotTraceEntry[];
}

const SUGGESTED_QUESTIONS = [
  'Who should I call first, and why?',
  'Why was the weight-gain call escalated?',
  'Draft the SBAR for Maria Santos.',
];

function initialProgress(): ScenarioProgress[] {
  return SIMULATED_CALL_SCENARIOS.map((scenario) => ({
    scenarioId: scenario.id,
    patientName: scenario.patientName,
    status: 'pending',
  }));
}

export function SandboxCopilot({ outreachItems, dayIndex, dayLog, populationSize, reviewedCount, onAdvanceDay, onRecordRun, onNavigate }: {
  outreachItems: OutreachWorkItem[];
  dayIndex: number;
  dayLog: SandboxDayLogEntry[];
  populationSize: PopulationSize;
  reviewedCount: number;
  onAdvanceDay: (escalations: number) => void;
  onRecordRun: (transcript: SimulatedCallTranscript) => void;
  onNavigate: (section: SandboxSectionId) => void;
}) {
  const [roundState, setRoundState] = useState<'idle' | 'running' | 'done' | 'unavailable'>('idle');
  const [progress, setProgress] = useState<ScenarioProgress[]>(initialProgress);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefState, setBriefState] = useState<'idle' | 'generating' | 'ready' | 'unavailable'>('idle');
  const [briefHasAudio, setBriefHasAudio] = useState(false);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<CopilotExchange[]>([]);
  const [chatStatus, setChatStatus] = useState<'idle' | 'busy' | 'unavailable'>('idle');
  const roundController = useRef<AbortController | null>(null);
  const { audioRef, needsTap, enqueue, resumeAfterTap } = useAssistantAudioQueue();

  const anonymousSessionId = () => getPublicDisseminationContext().anonymousSessionId;

  async function runMorningRound() {
    if (roundState === 'running' || briefState === 'generating') return;
    setRoundState('running');
    setBrief(null);
    setBriefState('idle');
    setBriefHasAudio(false);
    setElapsedSeconds(null);
    const controller = new AbortController();
    roundController.current = controller;
    const startedAt = Date.now();
    const runProgress = initialProgress();
    setProgress([...runProgress]);
    const completed: SimulatedCallTranscript[] = [];

    for (const [index, scenario] of SIMULATED_CALL_SCENARIOS.entries()) {
      runProgress[index] = { ...runProgress[index], status: 'calling' };
      setProgress([...runProgress]);
      try {
        const response = await fetch('/api/sandbox-ai/simulate-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenarioId: scenario.id, anonymousSessionId: anonymousSessionId() }),
          signal: controller.signal,
        });
        if (!response.ok && response.status !== 429) throw new Error('request failed');
        const body = (await response.json()) as { fallback?: boolean; transcript?: SimulatedCallTranscript };
        if (body.fallback || !body.transcript) {
          runProgress[index] = { ...runProgress[index], status: 'failed' };
          setProgress([...runProgress]);
          roundController.current = null;
          setRoundState('unavailable');
          return;
        }
        completed.push(body.transcript);
        onRecordRun(body.transcript);
        runProgress[index] = { ...runProgress[index], status: 'done', transcript: body.transcript };
        setProgress([...runProgress]);
      } catch {
        if (controller.signal.aborted) return;
        runProgress[index] = { ...runProgress[index], status: 'failed' };
        setProgress([...runProgress]);
        roundController.current = null;
        setRoundState('unavailable');
        return;
      }
    }

    // Triage over the fresh round is deterministic — the same registered rules
    // that set each disposition order the queue; no AI unit is spent here.
    setElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
    setRoundState('done');
    roundController.current = null;
    setBriefState('generating');

    // Brief over the fresh round plus what was already in the queue.
    const briefItems = [
      ...completed.map((transcript) => ({
        patientName: transcript.patientName,
        disposition: transcript.disposition,
        redFlagMessages: transcript.redFlags.map((flag) => flag.message).slice(0, 6),
        atLabel: 'This round',
      })),
      ...outreachItems.map((item) => ({
        patientName: item.patientName,
        disposition: item.disposition,
        redFlagMessages: item.redFlagMessages.slice(0, 6),
        atLabel: item.atLabel,
      })),
    ].slice(0, 12);
    const result = await requestAssist({
      kind: 'morning_brief',
      input: { items: briefItems },
      wantSpeech: true,
      anonymousSessionId: anonymousSessionId(),
    });
    if (result?.kind === 'morning_brief') {
      setBrief(result.brief);
      setBriefHasAudio(Boolean(result.mp3Base64));
      setBriefState('ready');
      if (result.mp3Base64) enqueue(`data:audio/mpeg;base64,${result.mp3Base64}`);
    } else {
      setBriefState('unavailable');
    }
  }

  function cancelMorningRound() {
    roundController.current?.abort();
    roundController.current = null;
    setRoundState('idle');
    setProgress(initialProgress());
    setBrief(null);
    setBriefState('idle');
    setBriefHasAudio(false);
    setElapsedSeconds(null);
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || chatStatus === 'busy') return;
    setChatStatus('busy');
    setQuestion('');
    try {
      const response = await fetch('/api/sandbox-ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed.slice(0, 300),
          snapshot: {
            workItems: outreachItems.slice(0, 20).map((item) => ({
              id: item.id,
              patientName: item.patientName,
              disposition: item.disposition,
              redFlagMessages: item.redFlagMessages.slice(0, 6),
              atLabel: item.atLabel,
            })),
          },
          dayIndex,
          populationSize,
          reviewedCount: Math.min(reviewedCount, 40),
          anonymousSessionId: anonymousSessionId(),
        }),
      });
      if (!response.ok && response.status !== 429) throw new Error('request failed');
      const body = (await response.json()) as { fallback?: boolean; answer?: string; toolTrace?: CopilotTraceEntry[] };
      if (body.fallback || !body.answer) {
        setChatStatus('unavailable');
        return;
      }
      setExchanges((current) => [...current.slice(-3), { question: trimmed, answer: body.answer!, toolTrace: body.toolTrace ?? [] }]);
      setChatStatus('idle');
    } catch {
      setChatStatus('unavailable');
    }
  }

  const escalations = progress.filter(
    (entry) => entry.transcript && entry.transcript.disposition !== 'routine',
  );
  const isFinalDay = dayIndex >= SANDBOX_DAY_COUNT - 1;
  const activeCallIndex = progress.findIndex((entry) => entry.status === 'calling');
  const completedCalls = progress.filter((entry) => entry.status === 'done').length;
  const progressPercent = Math.round((completedCalls / progress.length) * 100);

  function advance() {
    onAdvanceDay(escalations.length);
    setRoundState('idle');
    setProgress(initialProgress());
    setBrief(null);
    setBriefState('idle');
    setBriefHasAudio(false);
    setElapsedSeconds(null);
  }

  return (
    <div className="space-y-7" data-testid="sandbox-copilot">
      {/* Hidden element that plays the spoken morning brief. */}
      <audio ref={audioRef} data-testid="copilot-audio" />

      <SectionHeading
        eyebrow="Provider workspace"
        title="Copilot"
        description="The repetitive part of the morning — placing routine check-in calls, reading through the results, drafting the handoffs — runs automatically here. Registered clinical rules route every call; the AI structures conversations, narrates the queue, and drafts. A human reviews everything."
      />

      <SyntheticBanner>
        Everything below is a demonstration on synthetic personas — no real call, message, or
        record is created. Priority set by registered clinical rules · conversation structured by AI.
      </SyntheticBanner>

      {/* ── Full day run ── */}
      <section className="rounded-2xl border bg-white p-5" aria-label="Automated day run">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-950">
              Run the full day
              <span className="ml-2 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800" data-testid="copilot-day-badge">Day {dayIndex + 1} of {SANDBOX_DAY_COUNT}</span>
            </h3>
            <p className="mt-1 text-xs text-slate-500">Outreach calls to three synthetic personas, rule-based triage of the results, and the spoken brief — the repetitive part of one clinic day, end to end.</p>
          </div>
          {roundState === 'running' ? (
            <Button variant="outline" className="min-h-12 px-5" onClick={cancelMorningRound} data-testid="cancel-morning-round">
              <Square className="mr-2 size-4" /> Cancel run
            </Button>
          ) : (
            <Button
              className="min-h-12 bg-slate-950 px-5 hover:bg-slate-800"
              disabled={briefState === 'generating'}
              onClick={() => void runMorningRound()}
              data-testid="run-morning-round"
            >
              <Play className="mr-2 size-4" /> {roundState === 'done' ? 'Run the day again' : 'Run the full day'}
            </Button>
          )}
        </div>

        {roundState !== 'idle' && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3" role="status" aria-live="polite" data-testid="round-status">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
              <span className="text-slate-800">
                {roundState === 'running' && activeCallIndex >= 0
                  ? `Call ${activeCallIndex + 1} of ${progress.length} · ${progress[activeCallIndex].patientName}`
                  : roundState === 'done' && briefState === 'generating'
                    ? `${progress.length} of ${progress.length} calls complete · brief generating`
                    : roundState === 'done' && briefState === 'ready'
                      ? `${progress.length} of ${progress.length} calls complete · text ready · voice ${briefHasAudio ? 'ready' : 'not generated'}`
                      : roundState === 'unavailable' ? 'Automation paused · live assistant unavailable' : 'Automation complete'}
              </span>
              <span className="tabular-nums text-slate-500">{completedCalls}/{progress.length} calls</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Automated call progress" aria-valuemin={0} aria-valuemax={progress.length} aria-valuenow={completedCalls}>
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {roundState !== 'idle' && (
          <ul className="mt-4 space-y-2" data-testid="round-progress">
            {progress.map((entry) => (
              <li key={entry.scenarioId} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                <PhoneCall className={`size-4 ${entry.status === 'calling' ? 'animate-pulse text-blue-700' : 'text-slate-400'}`} aria-hidden="true" />
                <span className="mr-auto min-w-40 font-semibold text-slate-900">{entry.patientName}</span>
                {entry.status === 'calling' && <span className="text-xs font-semibold text-blue-700">Calling…</span>}
                {entry.status === 'pending' && <span className="text-xs text-slate-400">Waiting</span>}
                {entry.status === 'failed' && <span className="text-xs font-semibold text-slate-500">Unavailable</span>}
                {entry.status === 'done' && entry.transcript && <OutreachDispositionPill disposition={entry.transcript.disposition} />}
                {entry.status === 'done' && entry.transcript && entry.transcript.redFlags.length > 0 && (
                  <span className="w-full text-xs leading-5 text-slate-600">
                    {entry.transcript.redFlags.map((flag) => flag.message).join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {roundState === 'done' && elapsedSeconds !== null && (
          <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-950" data-testid="round-metric">
            {progress.length} automated check-ins processed and triaged in {elapsedSeconds}s —
            {' '}{escalations.length} escalation{escalations.length === 1 ? '' : 's'}, every disposition
            set by the registered clinical rules, never by the AI.
          </p>
        )}

        {roundState === 'unavailable' && (
          <p className="mt-3 rounded-xl border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700" data-testid="round-unavailable">
            The live round is unavailable right now (assistant disabled or usage cap reached). The
            pre-generated calls in Outreach demonstrate the same engine.
          </p>
        )}

        {briefState === 'generating' && (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm font-semibold text-violet-950" data-testid="brief-generating">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Calls complete. AI is drafting the reviewable morning brief…
          </p>
        )}

        {briefState === 'unavailable' && (
          <p className="mt-3 rounded-xl border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700">
            Calls and registered-rule dispositions are complete. The optional AI-drafted brief was unavailable; review the queue directly.
          </p>
        )}

        {brief && (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm leading-6 text-slate-800" data-testid="copilot-brief">
            {brief}
            {needsTap && (
              <span className="mt-2 block">
                <Button size="sm" variant="outline" onClick={resumeAfterTap}><Volume2 className="mr-1 size-4" /> Play the spoken brief</Button>
              </span>
            )}
            <p className="mt-2 text-[11px] font-semibold text-slate-600">
              AI-drafted and spoken summary — priorities were set by the registered clinical rules. Verify against the queue.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="copilot-day-controls">
          {dayLog.map((entry) => (
            <span key={entry.dayIndex} className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
              Day {entry.dayIndex + 1} ✓ · {entry.escalations} escalation{entry.escalations === 1 ? '' : 's'}
            </span>
          ))}
          {isFinalDay ? (
            <span className="text-xs font-semibold text-slate-500">Final simulated day — Reset the sandbox to start the week again.</span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              disabled={roundState !== 'done' || briefState === 'generating'}
              onClick={advance}
              data-testid="advance-day"
            >
              Advance to next day →
            </Button>
          )}
          {!isFinalDay && roundState !== 'done' && (
            <span className="text-xs text-slate-500">Complete this simulated day before advancing.</span>
          )}
        </div>

        {escalations.length > 0 && (
          <div className="mt-4 space-y-2" data-testid="copilot-prepared" aria-label="Prepared for review">
            <h4 className="text-sm font-bold text-slate-950">Prepared for your review</h4>
            {escalations.map((entry) => (
              <div key={entry.scenarioId} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">
                <p className="font-bold">{entry.patientName}</p>
                <ul className="mt-1 list-disc pl-4">
                  {entry.transcript?.redFlags.map((flag) => (
                    <li key={flag.id}>
                      {flag.message} — {flag.action}
                      <ExplainRuleButton ruleId={flag.id} extraction={entry.transcript?.extraction} />
                    </li>
                  ))}
                </ul>
                <span className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => onNavigate('outreach')}>Transcript &amp; SBAR</Button>
                  <Button size="sm" variant="outline" onClick={() => onNavigate('daily-loop')}>Open Daily Loop</Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Ask your queue ── */}
      <section className="rounded-2xl border bg-white p-5" aria-label="Ask your queue">
        <div className="flex items-center gap-3">
          <MessageSquareText className="size-5 shrink-0 text-blue-700" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-bold text-slate-950">Ask your queue</h3>
            <p className="mt-1 text-xs text-slate-500">
              The copilot answers from read-only tools over the synthetic queue and charts — and shows which it consulted.
            </p>
          </div>
        </div>

        {chatStatus !== 'unavailable' && (
          <>
            <form
              className="mt-4 flex items-center gap-2"
              onSubmit={(event) => { event.preventDefault(); void ask(question); }}
            >
              <label className="sr-only" htmlFor="copilot-question">Ask about the synthetic queue</label>
              <input
                id="copilot-question"
                className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                value={question}
                maxLength={300}
                placeholder="e.g. Who should I call first?"
                onChange={(event) => setQuestion(event.target.value)}
                disabled={chatStatus === 'busy'}
              />
              <Button type="submit" className="min-h-11" disabled={chatStatus === 'busy' || question.trim().length < 3} aria-label="Ask the copilot">
                <Send className="size-4" />
              </Button>
            </form>
            <p className="mt-2 text-[11px] font-semibold leading-4 text-violet-800">
              Synthetic prompts only — do not enter real patient, personal, or health information.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={chatStatus === 'busy'}
                  onClick={() => void ask(suggestion)}
                  className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </>
        )}

        {chatStatus === 'busy' && <p className="mt-3 text-sm text-slate-500">Consulting the queue tools…</p>}

        {exchanges.map((exchange, index) => (
          <div key={index} className="mt-3 rounded-xl border border-slate-200 p-3" data-testid="copilot-answer">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{exchange.question}</p>
            <p className="mt-2 text-sm leading-6 text-slate-800">{exchange.answer}</p>
            {exchange.toolTrace.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500" data-testid="copilot-trace">
                Consulted: {exchange.toolTrace.map((entry) => entry.summary).join(' → ')}
              </p>
            )}
          </div>
        ))}

        {chatStatus === 'unavailable' && (
          <p className="mt-3 rounded-xl border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700" data-testid="copilot-chat-unavailable">
            The copilot chat is unavailable right now (assistant disabled or usage cap reached). The
            queue itself, in the Daily Loop, is unaffected.
          </p>
        )}
      </section>

      <p className="text-[11px] leading-4 text-slate-500">
        Synthetic demonstration only — educational implementation-support resource, not medical
        advice, not for real patient use. The copilot reads and drafts; it never sets priorities,
        dispositions, or care actions — <span className="font-semibold">registered clinical rules decide, humans review.</span>
      </p>
    </div>
  );
}
