'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2 } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { callPromptsFor, fillerPromptsFor, quickAnswerLabel, QUICK_ANSWERS } from '@/lib/sandbox-ai/call-prompts';
import { applyDeterministicAnswer, createInitialState } from '@/lib/sandbox-ai/engine';
import type { CallLocale, CheckInDisposition, CheckInExtraction, CheckInState, CheckInTurnResponse, ScriptId, ScriptQuestionId, SpeechItem } from '@/lib/sandbox-ai/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag } from '@/lib/vitals/types';
import { Button } from '@/components/ui/button';
import { ExplainRuleButton } from './explain-rule';
import { useAssistantAudioQueue } from './use-assistant-audio-queue';

interface CallLine { speaker: 'assistant' | 'you'; text: string }
interface CallResult { disposition: CheckInDisposition; redFlags: RedFlag[]; detail: string }
type AnswerMode = 'Quick answer / structured entry' | 'Typed answer' | 'Voice answer';
type AiExtractionReceipt = 'not_used' | 'used' | 'unavailable' | 'mixed';

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

const RECEIPT_FIELDS: Record<ScriptId, Array<keyof CheckInExtraction>> = {
  daily_checkin: ['chestPainOrSyncope', 'weightLbs', 'dyspnea', 'edema', 'orthopnea', 'fatigue', 'adherence', 'sbp', 'spo2'],
  titration_followup: ['chestPainOrSyncope', 'dizziness', 'sbp', 'hr', 'worseSymptoms', 'adherence'],
};

const RECEIPT_LABELS: Record<keyof CheckInExtraction, string> = {
  weightLbs: 'Weight', sbp: 'Systolic BP', spo2: 'SpO₂', dyspnea: 'Breathing', edema: 'Swelling',
  orthopnea: 'Sleeping position', fatigue: 'Energy', adherence: 'Medication adherence',
  chestPainOrSyncope: 'Chest pain/fainting', hr: 'Heart rate', dizziness: 'Dizziness',
  worseSymptoms: 'New/worse symptoms',
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
  // Voice input is always opt-in. Answering the simulated call never opens the
  // microphone unless the visitor explicitly enables it first (or taps the mic
  // during the call).
  const [micOn, setMicOn] = useState(false);
  const [micSuspended, setMicSuspended] = useState(false);
  const [listenAttempt, setListenAttempt] = useState(0);
  const [speechPending, setSpeechPending] = useState(false);
  const [answerModes, setAnswerModes] = useState<AnswerMode[]>([]);
  const [aiExtractionReceipt, setAiExtractionReceipt] = useState<AiExtractionReceipt>('not_used');
  const { audioRef, speaking, needsTap, enqueue: enqueueAudio, resumeAfterTap } = useAssistantAudioQueue();
  const logRef = useRef<HTMLDivElement | null>(null);
  const startedTracked = useRef(false);
  const startedAt = useRef(Date.now());
  const micFailuresRef = useRef(0);
  const sendSpokenRef = useRef<(message: string) => void>(() => undefined);
  const speechPendingRef = useRef(false);
  const turnEpochRef = useRef(0);

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
    turnEpochRef.current += 1;
    speechPendingRef.current = false;
    setSpeechPending(false);
    setLocale(next);
    setCallState(createInitialState(patient.id, scriptId, next));
  }

  function setSpeechPhasePending(pending: boolean) {
    speechPendingRef.current = pending;
    setSpeechPending(pending);
  }

  function recordAnswerMode(mode: AnswerMode) {
    setAnswerModes((current) => current.includes(mode) ? current : [...current, mode]);
  }

  function recordAiExtraction(outcome: 'used' | 'unavailable') {
    setAiExtractionReceipt((current) => {
      if (current === 'not_used') return outcome;
      if (current === outcome || current === 'mixed') return current;
      return 'mixed';
    });
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

  function completeCall(turn: CheckInTurnResponse): number {
    const disposition = turn.disposition ?? 'routine';
    // The closing is always the LAST message; any earlier lines (a small-talk
    // ack on the final turn) play first with their own speech. The disposition
    // clip only queues once every earlier line is resolved — otherwise it is
    // deferred to finishPlayback so the ack is never spoken after the closing.
    const closing = turn.assistantMessages.at(-1) ?? '';
    const head = turn.assistantMessages.slice(0, -1);
    const stop = playSequence(head, (turn.speech ?? []).slice(0, head.length), 0, true);
    if (stop >= head.length) {
      enqueueClip(disposition === 'emergency' ? 'emergency' : disposition, closing);
    }
    setResult({ disposition, redFlags: turn.redFlags, detail: closing });
    setPhase('done');
    trackAiEvent('ai_checkin_completed', Math.min(Date.now() - startedAt.current, 3_600_000));
    if (disposition !== 'routine') trackAiEvent('ai_escalation_demonstrated');
    onComplete({ disposition, redFlagIds: turn.redFlags.map((flag) => flag.id) });
    return stop;
  }

  /**
   * Plays messages[from..] in order until a 'pending' speech slot (audio not
   * synthesized yet) and returns the index it stopped at. Text for pending
   * lines is shown immediately when `showPendingText` — that is the latency
   * win: the reply reads instantly while the audio phase catches up.
   */
  function playSequence(
    messages: string[],
    speech: Array<SpeechItem | null>,
    from: number,
    showPendingText: boolean,
  ): number {
    for (let index = from; index < messages.length; index += 1) {
      const item = speech[index] ?? null;
      if (item?.kind === 'pending') {
        if (showPendingText) {
          for (let ahead = index; ahead < messages.length; ahead += 1) {
            if ((speech[ahead] ?? null)?.kind === 'pending') addLine('assistant', messages[ahead]);
          }
        }
        return index;
      }
      if (item?.kind === 'clip') {
        enqueueClip(item.clipId);
      } else if (item?.kind === 'audio') {
        if (showPendingText) addLine('assistant', messages[index]);
        enqueueAudio(`data:audio/mpeg;base64,${item.mp3Base64}`);
      } else if (showPendingText) {
        addLine('assistant', messages[index]);
      }
    }
    return messages.length;
  }

  /** Phase 2: replay from where phase 1 stopped, audio now resolved (no re-adding text for pendings). */
  function resumePlayback(messages: string[], finalSpeech: Array<SpeechItem | null>, from: number) {
    for (let index = from; index < messages.length; index += 1) {
      const item = finalSpeech[index] ?? null;
      if (item?.kind === 'clip') enqueueClip(item.clipId);
      else if (item?.kind === 'audio') enqueueAudio(`data:audio/mpeg;base64,${item.mp3Base64}`);
      // null / unresolved pending: the text already showed in phase 1.
    }
  }

  /** Phase 2 entry: finish the interrupted playback, deferred closing clip included. */
  function finishPlayback(turn: CheckInTurnResponse, finalSpeech: Array<SpeechItem | null>, stop: number) {
    if (!turn.done) {
      resumePlayback(turn.assistantMessages, finalSpeech, stop);
      return;
    }
    const head = turn.assistantMessages.slice(0, -1);
    if (stop >= head.length) return; // closing clip already queued in phase 1
    resumePlayback(head, finalSpeech.slice(0, head.length), stop);
    const disposition = turn.disposition ?? 'routine';
    enqueueClip(disposition === 'emergency' ? 'emergency' : disposition, turn.assistantMessages.at(-1) ?? '');
  }

  function handleTurn(turn: CheckInTurnResponse, previousPhase: CheckInState['phase']): number {
    setCallState(turn.state);
    if (turn.done) {
      return completeCall(turn);
    }

    // Server-voiced turn: play exactly what the engine said, in order. Clip
    // refs display the clip's own wording so audio and text stay 1:1.
    if (turn.speech) {
      return playSequence(turn.assistantMessages, turn.speech, 0, true);
    }

    const nextPhase = turn.state.phase;
    if (nextPhase === previousPhase) {
      // Re-ask or deflection: repeat the current question aloud.
      enqueueClip('deflect');
      enqueueClip(nextPhase);
      return turn.assistantMessages.length;
    }
    enqueueClip(nextPhase);
    return turn.assistantMessages.length;
  }

  function answerWithChip(values: Partial<CheckInExtraction>, label: string) {
    if (busy || speechPendingRef.current || result) return;
    turnEpochRef.current += 1;
    recordAnswerMode('Quick answer / structured entry');
    addLine('you', label);
    handleTurn(applyDeterministicAnswer(callState, values), callState.phase);
  }

  /**
   * Reads the two-phase NDJSON reply: resolves the first line (the turn, with
   * text and any resolved clips) immediately and hands back a promise for the
   * final speech array from the second line. Plain-JSON replies (older shape,
   * test stubs, error paths) fall back to response.json().
   */
  async function readTurnPhases(response: Response): Promise<{
    turn: Partial<CheckInTurnResponse> & { fallback?: boolean };
    finalSpeech: Promise<Array<SpeechItem | null> | null>;
  }> {
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!response.body || !contentType.includes('ndjson')) {
      const turn = await response.json();
      return { turn, finalSpeech: Promise.resolve(turn.speech ?? null) };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const lines: string[] = [];
    async function readLine(): Promise<string | null> {
      while (lines.length === 0) {
        const { done, value } = await reader.read();
        if (done) {
          const rest = buffered.trim();
          buffered = '';
          return rest.length > 0 ? rest : null;
        }
        buffered += decoder.decode(value, { stream: true });
        const parts = buffered.split('\n');
        buffered = parts.pop() ?? '';
        lines.push(...parts.filter((part) => part.trim().length > 0));
      }
      return lines.shift() ?? null;
    }
    const first = await readLine();
    if (first === null) throw new Error('empty stream');
    const turn = JSON.parse(first);
    const finalSpeech = (async () => {
      try {
        const second = await readLine();
        return second ? (JSON.parse(second).speech ?? null) : null;
      } catch {
        return null;
      }
    })();
    return { turn, finalSpeech };
  }

  async function sendMessage(message: string, source: 'typed' | 'voice') {
    if (!message || busy || speechPendingRef.current || result) return;
    const turnEpoch = ++turnEpochRef.current;
    recordAnswerMode(source === 'voice' ? 'Voice answer' : 'Typed answer');
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
      const { turn, finalSpeech } = await readTurnPhases(response);
      if (turnEpochRef.current !== turnEpoch) return;
      if (turn.fallback || !turn.state) {
        recordAiExtraction('unavailable');
        setOfflineMode(true);
        trackAiEvent('ai_checkin_fallback');
        addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The call works exactly the same way.');
        return;
      }
      const fullTurn = turn as CheckInTurnResponse;
      recordAiExtraction('used');
      const stop = handleTurn(fullTurn, previousPhase);
      if ((fullTurn.speech ?? []).some((item) => item?.kind === 'pending')) {
        // Text renders immediately, but the next visitor turn stays locked
        // until this turn's audio phase resolves. The epoch also prevents a
        // late phase-2 payload from attaching itself to a newer turn.
        setSpeechPhasePending(true);
        void (async () => {
          const resolved = await Promise.race([
            finalSpeech,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
          ]);
          const speech = resolved
            ?? (fullTurn.speech ?? []).map((item) => (item?.kind === 'pending' ? null : item));
          if (turnEpochRef.current !== turnEpoch) return;
          finishPlayback(fullTurn, speech, stop);
          setSpeechPhasePending(false);
        })();
      }
    } catch {
      if (turnEpochRef.current !== turnEpoch) return;
      recordAiExtraction('unavailable');
      setOfflineMode(true);
      trackAiEvent('ai_checkin_fallback');
      addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The call works exactly the same way.');
    } finally {
      if (turnEpochRef.current === turnEpoch) setBusy(false);
    }
  }
  useEffect(() => {
    sendSpokenRef.current = (message: string) => { void sendMessage(message, 'voice'); };
  });

  async function answerWithText() {
    const message = input.trim();
    if (!message) return;
    setInput('');
    await sendMessage(message, 'typed');
  }

  // ── Hands-free listening: open the mic whenever the assistant is quiet ──

  const voiceActive = voiceSupported && micOn && !micSuspended && !offlineMode
    && phase === 'active' && !result && !busy && !speechPending && !speaking && !needsTap;

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
    if (busy || speechPendingRef.current || result) return;
    turnEpochRef.current += 1;
    recordAnswerMode('Quick answer / structured entry');
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
  const turnLocked = busy || speechPending;

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
          {voiceSupported && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-left" id="live-call-mic-disclosure">
              <button
                type="button"
                aria-pressed={micOn}
                aria-describedby="live-call-mic-disclosure-copy"
                data-testid="live-call-mic-opt-in"
                onClick={toggleMic}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-950 hover:bg-blue-100"
              >
                {micOn ? <Mic className="size-4" aria-hidden="true" /> : <MicOff className="size-4" aria-hidden="true" />}
                {micOn ? 'Microphone enabled' : 'Enable optional microphone'}
              </button>
              <p id="live-call-mic-disclosure-copy" className="mt-2 text-[11px] leading-4 text-blue-950">
                Optional. Your browser speech service transcribes audio, then the transcript is processed by the sandbox AI to structure this synthetic turn. Do not say real patient, personal, or health information.
              </p>
            </div>
          )}
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
          <div ref={logRef} className="max-h-64 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Call transcript" lang={locale === 'es' ? 'es-US' : 'en-US'}>
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
                  : speechPending
                    ? 'Assistant reply ready — preparing audio…'
                    : busy
                    ? 'Thinking…'
                    : speaking
                      ? 'Assistant speaking…'
                      : listening
                        ? 'Listening — just talk'
                        : 'Getting ready…'}
            </p>
          )}

          {speechPending && !showVoiceStatus && (
            <p className="px-3 pb-1 text-[11px] font-semibold text-slate-600" role="status">
              Assistant reply ready — preparing audio…
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
              <DecisionReceipt
                scriptId={scriptId}
                extraction={callState.extraction}
                answerModes={answerModes}
                aiExtractionReceipt={aiExtractionReceipt}
                result={result}
              />
            </div>
          )}

          {!result && currentQuestion && (
            <div className="space-y-2 border-t p-3">
              {chips && (
                <div className="flex flex-wrap gap-2" data-testid="live-call-chips">
                  {chips.map((chip) => (
                    <Button key={chip.label} size="sm" variant="outline" disabled={turnLocked} onClick={() => answerWithChip(chip.values, quickAnswerLabel(chip, locale))}>
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
                  <Button type="submit" size="sm" variant="outline" disabled={turnLocked} className="min-h-11">
                    {currentQuestion === 'q2_weight' ? 'Send' : 'Send / skip'}
                  </Button>
                </form>
              )}
              {!offlineMode && !numericFields && (
                <div>
                  <p id="live-call-synthetic-input-note" className="mb-2 text-[11px] font-semibold leading-4 text-amber-800">
                    Synthetic answers only — do not enter real patient, personal, or health information.
                  </p>
                  <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void answerWithText(); }}>
                    <label className="sr-only" htmlFor="live-call-input">Say something in your own words</label>
                    <input
                      id="live-call-input"
                      className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
                      value={input}
                      maxLength={500}
                      aria-describedby="live-call-synthetic-input-note"
                      placeholder={voiceSupported && micOn && !micSuspended ? '…or type instead of talking' : '…or answer in your own words'}
                      onChange={(event) => setInput(event.target.value)}
                      disabled={turnLocked}
                    />
                    <Button type="submit" className="min-h-11" disabled={turnLocked || input.trim().length === 0} aria-label="Send typed answer"><Send className="size-4" /></Button>
                  </form>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="border-t px-3 py-2 text-[11px] leading-4 text-slate-500">
        Synthetic demonstration only — no real call, no medical advice. Assistant audio is
        synthetic voice; your answers are structured by AI and
        <span className="font-semibold"> preset clinical rules decide escalation.</span> Voice
        input uses your browser&apos;s speech service; its transcript is processed by the sandbox AI for this synthetic turn. Do not share real patient, personal, or health information.
      </p>
    </section>
  );
}

function formatReceiptValue(value: CheckInExtraction[keyof CheckInExtraction]): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return value ? value.replaceAll('_', ' ') : 'Not established';
}

function DecisionReceipt({ scriptId, extraction, answerModes, aiExtractionReceipt, result }: {
  scriptId: ScriptId;
  extraction: CheckInExtraction;
  answerModes: AnswerMode[];
  aiExtractionReceipt: AiExtractionReceipt;
  result: CallResult;
}) {
  const fields = RECEIPT_FIELDS[scriptId];
  const established = fields.filter((field) => extraction[field] !== null);
  const unknown = fields.filter((field) => extraction[field] === null);
  const aiExtractionCopy: Record<AiExtractionReceipt, string> = {
    not_used: 'Not used — structured controls mapped directly',
    used: 'Used for accepted typed/voice answer(s)',
    unavailable: 'Attempted but unavailable — no AI extraction used for that turn',
    mixed: 'Used for accepted turn(s); unavailable on another typed/voice attempt',
  };
  const rules = result.redFlags.length > 0
    ? result.redFlags.map((flag) => flag.id).join(', ')
    : result.disposition === 'emergency'
      ? 'Emergency safety short-circuit'
      : 'No red-flag rule fired';
  const humanNextAction = result.disposition === 'emergency'
    ? 'Emergency response and care-team follow-up required.'
    : result.disposition === 'escalated'
      ? 'Provider or nurse reviews before any care action.'
      : scriptId === 'titration_followup'
        ? 'Care team confirms the next dose step; no autonomous change.'
        : 'Care team may review the monitoring record; no autonomous action.';

  return (
    <div className="mt-3 rounded-lg border border-current/20 bg-white/70 p-3 text-slate-900" data-testid="live-call-decision-receipt">
      <p className="font-bold">Decision receipt</p>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-600">Input source</dt><dd>{answerModes.join(' + ') || 'No answer captured'}</dd></div>
        <div>
          <dt className="font-semibold text-slate-600">AI extraction</dt>
          <dd>{aiExtractionCopy[aiExtractionReceipt]}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-semibold text-slate-600">Structured values</dt>
          <dd>{established.length > 0 ? established.map((field) => `${RECEIPT_LABELS[field]}: ${formatReceiptValue(extraction[field])}`).join(' · ') : 'None established'}</dd>
        </div>
        <div className="sm:col-span-2"><dt className="font-semibold text-slate-600">Unknowns</dt><dd>{unknown.length > 0 ? unknown.map((field) => RECEIPT_LABELS[field]).join(', ') : 'None'}</dd></div>
        <div><dt className="font-semibold text-slate-600">Registered-rule receipt</dt><dd>{rules} · {result.disposition}</dd></div>
        <div><dt className="font-semibold text-slate-600">Human next action</dt><dd>{humanNextAction}</dd></div>
      </dl>
    </div>
  );
}
