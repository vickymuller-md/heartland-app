'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2 } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { callPromptsFor, fillerPromptsFor, quickAnswerLabel, QUICK_ANSWERS } from '@/lib/sandbox-ai/call-prompts';
import { applyDeterministicAnswer, createInitialState } from '@/lib/sandbox-ai/engine';
import type { CallLocale, CheckInDisposition, CheckInExtraction, CheckInState, CheckInTurnResponse, ScriptId, ScriptQuestionId } from '@/lib/sandbox-ai/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag } from '@/lib/vitals/types';
import { Button } from '@/components/ui/button';
import { ExplainRuleButton } from './explain-rule';
import { useAssistantAudioQueue } from './use-assistant-audio-queue';

interface CallLine { speaker: 'assistant' | 'you'; text: string }
interface CallResult { disposition: CheckInDisposition; redFlags: RedFlag[]; detail: string }

const RESULT_BOXES: Record<CheckInDisposition, string> = {
  emergency: 'border-red-300 bg-red-50 text-red-950',
  escalated: 'border-amber-300 bg-amber-50 text-amber-950',
  routine: 'border-emerald-300 bg-emerald-50 text-emerald-950',
};

const RESULT_TITLES: Record<ScriptId, Record<CheckInDisposition, string>> = {
  daily_checkin: {
    emergency: 'Emergency pathway demonstrated',
    escalated: 'Escalated to human review',
    routine: 'Routine — stays in the monitoring queue',
  },
  titration_followup: {
    emergency: 'Emergency pathway demonstrated',
    escalated: 'Held for nurse review',
    routine: 'Proceed confirmed — safety gates passed',
  },
};

const SCRIPT_COPY: Record<ScriptId, { header: string; calling: string; note: string; ruleNote: string }> = {
  daily_checkin: {
    header: 'HEARTLAND check-in',
    calling: 'Automated daily check-in calling…',
    note: 'Answer the automated daily call and play the synthetic patient.',
    ruleNote: 'Disposition set by the registered clinical rules, never by the AI.',
  },
  titration_followup: {
    header: 'Titration follow-up',
    calling: 'Titration follow-up calling…',
    note: 'Answer the follow-up about the recent dose adjustment and play the synthetic patient.',
    ruleNote: 'Outcome set by the registered titration safety gates, never by the AI. No dose changes without provider confirmation.',
  },
};

/** Numeric inputs per question (chips cover everything else). */
const NUMERIC_FIELDS: Partial<Record<ScriptQuestionId, Array<'weight' | 'sbp' | 'spo2' | 'hr'>>> = {
  q2_weight: ['weight'],
  q8_devices: ['sbp', 'spo2'],
  t3_sbp: ['sbp'],
  t4_hr: ['hr'],
};

// ── Minimal Web Speech API surface (not in lib.dom; webkit-prefixed in practice) ──

interface SpeechAlternativeLike { transcript: string }
interface SpeechResultLike { 0: SpeechAlternativeLike; isFinal: boolean }
interface SpeechRecognitionEventLike { results: { length: number; [index: number]: SpeechResultLike } }
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function fullTranscript(event: SpeechRecognitionEventLike): string {
  let text = '';
  for (let index = 0; index < event.results.length; index += 1) {
    text += event.results[index]?.[0]?.transcript ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function trackAiEvent(eventName: ProductEventInput['eventName'], durationMs?: number) {
  void trackProductEvent({ eventName, area: 'sandbox', durationMs, ...getPublicDisseminationContext() });
}

export interface LiveCallOutcome {
  disposition: 'routine' | 'escalated' | 'emergency';
  redFlagIds: string[];
}

export function SandboxLiveCall({ patient, scriptId = 'daily_checkin', onComplete, onClose }: {
  /** Only id (call state) and name are read — population descriptors welcome. */
  patient: Pick<SandboxPatient, 'id' | 'name'>;
  scriptId?: ScriptId;
  onComplete: (outcome?: LiveCallOutcome) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ringing' | 'active' | 'done'>('ringing');
  const [locale, setLocale] = useState<CallLocale>('en');
  const [lines, setLines] = useState<CallLine[]>([]);
  const [callState, setCallState] = useState<CheckInState>(() => createInitialState(patient.id, scriptId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceSupported] = useState(() => speechRecognitionCtor() !== null);
  const [micOn, setMicOn] = useState(true);
  const [micSuspended, setMicSuspended] = useState(false);
  const [listenAttempt, setListenAttempt] = useState(0);
  const { audioRef, speaking, needsTap, enqueue: enqueueAudio, resumeAfterTap } = useAssistantAudioQueue();
  const logRef = useRef<HTMLDivElement | null>(null);
  const startedTracked = useRef(false);
  const startedAt = useRef(Date.now());
  const micFailuresRef = useRef(0);
  const sendSpokenRef = useRef<(message: string) => void>(() => undefined);

  const prompts = callPromptsFor(scriptId, locale);
  const copy = SCRIPT_COPY[scriptId];

  useEffect(() => {
    if (phase !== 'active') return;
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines, interim, result]);

  function addLine(speaker: CallLine['speaker'], text: string) {
    setLines((current) => [...current, { speaker, text }]);
  }

  /** Transcript line + pre-generated clip for one fixed spoken prompt. */
  function enqueueClip(promptId: string, textOverride?: string) {
    const clip = prompts[promptId];
    addLine('assistant', textOverride ?? clip?.text ?? '');
    if (clip) enqueueAudio(clip.audioSrc);
  }

  function chooseLocale(next: CallLocale) {
    if (phase !== 'ringing' || next === locale) return;
    setLocale(next);
    setCallState(createInitialState(patient.id, scriptId, next));
  }

  function trackStartOnce() {
    if (startedTracked.current) return;
    startedTracked.current = true;
    startedAt.current = Date.now();
    trackAiEvent('ai_checkin_started');
  }

  function answer() {
    trackStartOnce();
    setPhase('active');
    enqueueClip('intro');
    enqueueClip(callState.phase);
  }

  function completeCall(turn: CheckInTurnResponse) {
    const disposition = turn.disposition ?? 'routine';
    enqueueClip(disposition === 'emergency' ? 'emergency' : disposition, turn.assistantMessages[0]);
    setResult({ disposition, redFlags: turn.redFlags, detail: turn.assistantMessages[0] ?? '' });
    setPhase('done');
    trackAiEvent('ai_checkin_completed', Math.min(Date.now() - startedAt.current, 3_600_000));
    if (disposition !== 'routine') trackAiEvent('ai_escalation_demonstrated');
    onComplete({ disposition, redFlagIds: turn.redFlags.map((flag) => flag.id) });
  }

  function handleTurn(turn: CheckInTurnResponse, previousPhase: CheckInState['phase']) {
    setCallState(turn.state);
    if (turn.done) {
      completeCall(turn);
      return;
    }

    // Server-voiced turn: play exactly what the engine said, in order. Clip
    // refs display the clip's own wording so audio and text stay 1:1.
    if (turn.speech) {
      turn.assistantMessages.forEach((message, index) => {
        const item = turn.speech?.[index] ?? null;
        if (item?.kind === 'clip') {
          enqueueClip(item.clipId);
        } else if (item?.kind === 'audio') {
          addLine('assistant', message);
          enqueueAudio(`data:audio/mpeg;base64,${item.mp3Base64}`);
        } else {
          addLine('assistant', message);
        }
      });
      return;
    }

    const nextPhase = turn.state.phase;
    if (nextPhase === previousPhase) {
      // Re-ask or deflection: repeat the current question aloud.
      enqueueClip('deflect');
      enqueueClip(nextPhase);
      return;
    }
    enqueueClip(nextPhase);
  }

  function answerWithChip(values: Partial<CheckInExtraction>, label: string) {
    if (busy || result) return;
    addLine('you', label);
    handleTurn(applyDeterministicAnswer(callState, values), callState.phase);
  }

  async function sendMessage(message: string) {
    if (!message || busy || result) return;
    setBusy(true);
    addLine('you', message);
    // Conversational filler covers the model+synthesis latency (clip audio 1:1).
    const fillers = fillerPromptsFor(locale);
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    if (filler) enqueueClip(filler.id, filler.text);
    const previousPhase = callState.phase;
    try {
      const response = await fetch('/api/sandbox-ai/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: callState,
          message,
          anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
          wantSpeech: true,
        }),
      });
      if (!response.ok && response.status !== 429) throw new Error('request failed');
      const turn = (await response.json()) as Partial<CheckInTurnResponse> & { fallback?: boolean };
      if (turn.fallback || !turn.state) {
        setOfflineMode(true);
        trackAiEvent('ai_checkin_fallback');
        addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The call works exactly the same way.');
        return;
      }
      handleTurn(turn as CheckInTurnResponse, previousPhase);
    } catch {
      setOfflineMode(true);
      trackAiEvent('ai_checkin_fallback');
      addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The call works exactly the same way.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    sendSpokenRef.current = (message: string) => { void sendMessage(message); };
  });

  async function answerWithText() {
    const message = input.trim();
    if (!message) return;
    setInput('');
    await sendMessage(message);
  }

  // ── Hands-free listening: open the mic whenever the assistant is quiet ──

  const voiceActive = voiceSupported && micOn && !micSuspended && !offlineMode
    && phase === 'active' && !result && !busy && !speaking && !needsTap;

  useEffect(() => {
    if (!voiceActive) return;
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    let finalized = false;
    let active = true;
    const recognition = new Ctor();
    recognition.lang = locale === 'es' ? 'es-US' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;

    const failed = () => {
      micFailuresRef.current += 1;
      if (micFailuresRef.current >= 2) {
        setMicSuspended(true);
      } else {
        setListenAttempt((attempt) => attempt + 1);
      }
    };

    recognition.onresult = (event) => {
      const transcript = fullTranscript(event);
      setInterim(transcript);
      const last = event.results[event.results.length - 1];
      if (!last?.isFinal || finalized) return;
      finalized = true;
      setInterim('');
      setListening(false);
      try { recognition.stop(); } catch { /* already stopped */ }
      if (transcript.length > 0) {
        micFailuresRef.current = 0;
        sendSpokenRef.current(transcript.slice(0, 500));
      } else {
        failed();
      }
    };
    recognition.onend = () => {
      setListening(false);
      setInterim('');
      if (active && !finalized) failed();
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      failed();
    }
    return () => {
      active = false;
      setListening(false);
      setInterim('');
      try { recognition.abort(); } catch { /* already gone */ }
    };
  }, [voiceActive, listenAttempt, locale]);

  function toggleMic() {
    if (micOn) {
      setMicOn(false);
      return;
    }
    micFailuresRef.current = 0;
    setMicSuspended(false);
    setMicOn(true);
  }

  function submitNumbers(formData: FormData) {
    if (busy || result) return;
    const current = callState.phase;
    const fields = NUMERIC_FIELDS[current as ScriptQuestionId] ?? [];
    const numberOrNull = (name: string, min: number, max: number) => {
      const raw = String(formData.get(name) ?? '').trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= min && value <= max ? value : null;
    };
    const values: Partial<CheckInExtraction> = {};
    const said: string[] = [];
    if (fields.includes('weight')) {
      const weight = numberOrNull('weight', 50, 500);
      if (weight === null) return; // weight is required by its form input
      values.weightLbs = weight;
      said.push(`${weight} pounds`);
    }
    if (fields.includes('sbp')) {
      const sbp = numberOrNull('sbp', 50, 260);
      if (sbp !== null) { values.sbp = sbp; said.push(`BP ${sbp}`); }
    }
    if (fields.includes('spo2')) {
      const spo2 = numberOrNull('spo2', 50, 100);
      if (spo2 !== null) { values.spo2 = spo2; said.push(`oxygen ${spo2}`); }
    }
    if (fields.includes('hr')) {
      const hr = numberOrNull('hr', 30, 220);
      if (hr !== null) { values.hr = hr; said.push(`pulse ${hr}`); }
    }
    addLine('you', said.length > 0 ? said.join(' · ') : "I'll skip that one");
    handleTurn(applyDeterministicAnswer(callState, values), current);
  }

  const minutes = String(Math.floor(seconds / 60)).padStart(1, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  const currentQuestion = callState.phase !== 'complete' ? callState.phase : null;
  const chips = currentQuestion ? QUICK_ANSWERS[currentQuestion as ScriptQuestionId] : undefined;
  const numericFields = currentQuestion ? NUMERIC_FIELDS[currentQuestion as ScriptQuestionId] : undefined;
  const showVoiceStatus = voiceSupported && phase === 'active' && !result && !offlineMode;

  return (
    <section className="rounded-xl border border-emerald-200 bg-white" data-testid="sandbox-live-call" aria-label="Simulated incoming call">
      {/* Hidden element that plays the assistant's clips and synthesized lines. */}
      <audio ref={audioRef} data-testid="live-call-audio" />

      <div className="flex items-center justify-between gap-2 rounded-t-xl bg-emerald-50 px-3 py-2">
        <p className="text-xs font-bold text-emerald-950">
          {phase === 'ringing' ? `Incoming call · ${copy.header}` : `${copy.header} · ${minutes}:${secs}`} · Simulation
        </p>
        <div className="flex items-center gap-1">
          {voiceSupported && phase === 'active' && !result && (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={micOn}
              aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
              data-testid="live-call-mic-toggle"
              className={`flex size-8 items-center justify-center rounded-full ${micOn ? 'text-emerald-900 hover:bg-emerald-100' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
            >
              {micOn ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="End simulated call" className="flex size-8 items-center justify-center rounded-full text-emerald-900 hover:bg-emerald-100"><PhoneOff className="size-4" /></button>
        </div>
      </div>

      {phase === 'ringing' && (
        <div className="space-y-3 p-4 text-center">
          <span className="mx-auto flex size-14 animate-pulse items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Phone className="size-6" /></span>
          <p className="text-sm font-bold text-slate-950">{copy.calling}</p>
          <p className="text-xs leading-5 text-slate-600">
            {copy.note} The assistant speaks out loud
            {voiceSupported ? ' — answer by talking, typing, or tapping' : ''}; preset clinical rules decide the outcome.
          </p>
          <div className="flex justify-center gap-2" role="group" aria-label="Call language">
            {(['en', 'es'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={locale === option}
                data-testid={`call-locale-${option}`}
                onClick={() => chooseLocale(option)}
                className={`min-h-9 rounded-full px-4 text-xs font-semibold ${locale === option ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {option === 'en' ? 'English' : 'Español'}
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2">
            <Button className="min-h-11 bg-emerald-700 hover:bg-emerald-800" onClick={answer} data-testid="answer-call"><Phone className="mr-2 size-4" /> Answer</Button>
            <Button variant="outline" className="min-h-11" onClick={onClose}>Decline</Button>
          </div>
        </div>
      )}

      {phase !== 'ringing' && (
        <>
          <div ref={logRef} className="max-h-64 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Call transcript">
            {lines.map((line, index) => (
              <p key={index} className={line.speaker === 'assistant'
                ? 'mr-6 rounded-lg rounded-bl-none bg-slate-100 p-2.5 text-xs leading-5 text-slate-900'
                : 'ml-6 rounded-lg rounded-br-none bg-emerald-600 p-2.5 text-xs leading-5 text-white'}>
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70">{line.speaker === 'assistant' ? 'Assistant (voice)' : 'You'}</span>
                {line.text}
              </p>
            ))}
            {interim.length > 0 && (
              <p className="ml-6 rounded-lg rounded-br-none bg-emerald-600/60 p-2.5 text-xs leading-5 text-white">
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70">You (speaking…)</span>
                {interim}
              </p>
            )}
          </div>

          {showVoiceStatus && (
            <p className="px-3 pb-1 text-[11px] font-semibold text-emerald-800" data-testid="live-call-voice-status" aria-live="polite">
              {micSuspended
                ? 'Voice input paused — use the quick answers or type below, or tap the mic to try again.'
                : !micOn
                  ? 'Microphone off — type or tap your answers.'
                  : busy
                    ? 'Thinking…'
                    : speaking
                      ? 'Assistant speaking…'
                      : listening
                        ? 'Listening — just talk'
                        : 'Getting ready…'}
            </p>
          )}

          {needsTap && !result && (
            <div className="px-3 pb-2">
              <Button size="sm" variant="outline" onClick={resumeAfterTap}>
                <Volume2 className="mr-1 size-4" /> Play assistant audio
              </Button>
            </div>
          )}

          {result && (
            <div className={`mx-3 mb-3 rounded-lg border p-3 text-xs leading-5 ${RESULT_BOXES[result.disposition]}`} data-testid="live-call-result">
              <p className="font-bold">{RESULT_TITLES[scriptId][result.disposition]}</p>
              {result.redFlags.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.redFlags.map((flag) => (
                    <li key={flag.id}>
                      {flag.message} — {flag.action}
                      <ExplainRuleButton ruleId={flag.id} extraction={callState.extraction} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1">{copy.ruleNote}</p>
            </div>
          )}

          {!result && currentQuestion && (
            <div className="space-y-2 border-t p-3">
              {chips && (
                <div className="flex flex-wrap gap-2" data-testid="live-call-chips">
                  {chips.map((chip) => (
                    <Button key={chip.label} size="sm" variant="outline" disabled={busy} onClick={() => answerWithChip(chip.values, quickAnswerLabel(chip, locale))}>
                      {quickAnswerLabel(chip, locale)}
                    </Button>
                  ))}
                </div>
              )}
              {numericFields && (
                <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={(event) => { event.preventDefault(); submitNumbers(new FormData(event.currentTarget)); }} data-testid="live-call-numbers">
                  {numericFields.includes('weight') && (
                    <label className="flex flex-col gap-1 font-semibold">Weight (lbs)
                      <input name="weight" type="number" min={50} max={500} step="0.1" required className="min-h-11 w-28 rounded-lg border border-slate-300 px-2 font-normal" />
                    </label>
                  )}
                  {numericFields.includes('sbp') && (
                    <label className="flex flex-col gap-1 font-semibold">Systolic BP
                      <input name="sbp" type="number" min={50} max={260} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 font-normal" />
                    </label>
                  )}
                  {numericFields.includes('spo2') && (
                    <label className="flex flex-col gap-1 font-semibold">Oxygen %
                      <input name="spo2" type="number" min={50} max={100} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 font-normal" />
                    </label>
                  )}
                  {numericFields.includes('hr') && (
                    <label className="flex flex-col gap-1 font-semibold">Pulse (bpm)
                      <input name="hr" type="number" min={30} max={220} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 font-normal" />
                    </label>
                  )}
                  <Button type="submit" size="sm" variant="outline" disabled={busy} className="min-h-11">
                    {currentQuestion === 'q2_weight' ? 'Send' : 'Send / skip'}
                  </Button>
                </form>
              )}
              {!offlineMode && !numericFields && (
                <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void answerWithText(); }}>
                  <label className="sr-only" htmlFor="live-call-input">Say something in your own words</label>
                  <input
                    id="live-call-input"
                    className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                    value={input}
                    maxLength={500}
                    placeholder={voiceSupported && micOn && !micSuspended ? '…or type instead of talking' : '…or answer in your own words'}
                    onChange={(event) => setInput(event.target.value)}
                    disabled={busy}
                  />
                  <Button type="submit" className="min-h-11" disabled={busy || input.trim().length === 0} aria-label="Send spoken answer"><Send className="size-4" /></Button>
                </form>
              )}
            </div>
          )}
        </>
      )}

      <p className="border-t px-3 py-2 text-[11px] leading-4 text-slate-500">
        Synthetic demonstration only — no real call, no medical advice. Assistant audio is
        synthetic voice; your answers are structured by AI and
        <span className="font-semibold"> preset clinical rules decide escalation.</span> Voice
        input is transcribed by your browser&apos;s speech service and is never stored.
      </p>
    </section>
  );
}
