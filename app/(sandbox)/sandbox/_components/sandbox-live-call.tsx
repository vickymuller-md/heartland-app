'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2 } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { CALL_PROMPTS, QUICK_ANSWERS } from '@/lib/sandbox-ai/call-prompts';
import { applyDeterministicAnswer, createInitialState } from '@/lib/sandbox-ai/engine';
import type { CheckInDisposition, CheckInExtraction, CheckInState, CheckInTurnResponse, ScriptQuestionId } from '@/lib/sandbox-ai/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag } from '@/lib/vitals/types';
import { Button } from '@/components/ui/button';

interface CallLine { speaker: 'assistant' | 'you'; text: string }
interface CallResult { disposition: CheckInDisposition; redFlags: RedFlag[]; detail: string }

const RESULT_STYLES: Record<CheckInDisposition, { box: string; title: string }> = {
  emergency: { box: 'border-red-300 bg-red-50 text-red-950', title: 'Emergency pathway demonstrated' },
  escalated: { box: 'border-amber-300 bg-amber-50 text-amber-950', title: 'Escalated to human review' },
  routine: { box: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: 'Routine — stays in the monitoring queue' },
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

export function SandboxLiveCall({ patient, onComplete, onClose }: {
  patient: SandboxPatient;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'ringing' | 'active' | 'done'>('ringing');
  const [lines, setLines] = useState<CallLine[]>([]);
  const [callState, setCallState] = useState<CheckInState>(() => createInitialState(patient.id));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [needsTap, setNeedsTap] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceSupported] = useState(() => speechRecognitionCtor() !== null);
  const [micOn, setMicOn] = useState(true);
  const [micSuspended, setMicSuspended] = useState(false);
  const [listenAttempt, setListenAttempt] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const startedTracked = useRef(false);
  const startedAt = useRef(Date.now());
  const queueRef = useRef<string[]>([]);
  const playingRef = useRef(false);
  const micFailuresRef = useRef(0);
  const sendSpokenRef = useRef<(message: string) => void>(() => undefined);

  useEffect(() => {
    if (phase !== 'active') return;
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines, interim, result]);

  // ── Assistant audio queue (clips + synthesized lines share one element) ──

  function playNext() {
    const audio = audioRef.current;
    const next = queueRef.current.shift();
    if (!audio || !next) {
      playingRef.current = false;
      setSpeaking(false);
      return;
    }
    playingRef.current = true;
    setSpeaking(true);
    try {
      audio.src = next;
      const playing = audio.play();
      setNeedsTap(null);
      playing?.catch(() => setNeedsTap(next));
    } catch {
      setNeedsTap(next);
    }
  }
  const playNextRef = useRef(playNext);
  playNextRef.current = playNext;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const advance = () => playNextRef.current();
    audio.addEventListener('ended', advance);
    audio.addEventListener('error', advance);
    return () => {
      audio.removeEventListener('ended', advance);
      audio.removeEventListener('error', advance);
    };
  }, []);

  function enqueueAudio(src: string) {
    queueRef.current.push(src);
    if (!playingRef.current) playNext();
  }

  function addLine(speaker: CallLine['speaker'], text: string) {
    setLines((current) => [...current, { speaker, text }]);
  }

  /** Transcript line + pre-generated clip for one fixed spoken prompt. */
  function enqueueClip(promptId: string, textOverride?: string) {
    const clip = CALL_PROMPTS[promptId];
    addLine('assistant', textOverride ?? clip?.text ?? '');
    if (clip) enqueueAudio(clip.audioSrc);
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
    enqueueClip('q1_safety');
  }

  function completeCall(turn: CheckInTurnResponse) {
    const disposition = turn.disposition ?? 'routine';
    enqueueClip(disposition === 'emergency' ? 'emergency' : disposition, turn.assistantMessages[0]);
    setResult({ disposition, redFlags: turn.redFlags, detail: turn.assistantMessages[0] ?? '' });
    setPhase('done');
    trackAiEvent('ai_checkin_completed', Math.min(Date.now() - startedAt.current, 3_600_000));
    if (disposition !== 'routine') trackAiEvent('ai_escalation_demonstrated');
    onComplete();
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
        addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The check-in works exactly the same way.');
        return;
      }
      handleTurn(turn as CheckInTurnResponse, previousPhase);
    } catch {
      setOfflineMode(true);
      trackAiEvent('ai_checkin_fallback');
      addLine('assistant', 'Spoken and typed answers are unavailable right now — please use the quick answers below. The check-in works exactly the same way.');
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
    recognition.lang = 'en-US';
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
  }, [voiceActive, listenAttempt]);

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
    if (current === 'q2_weight') {
      const weight = Number(formData.get('weight'));
      if (!Number.isFinite(weight) || weight < 50 || weight > 500) return;
      addLine('you', `${weight} pounds`);
      handleTurn(applyDeterministicAnswer(callState, { weightLbs: weight }), current);
      return;
    }
    const sbpRaw = String(formData.get('sbp') ?? '').trim();
    const spo2Raw = String(formData.get('spo2') ?? '').trim();
    const sbp = sbpRaw ? Number(sbpRaw) : null;
    const spo2 = spo2Raw ? Number(spo2Raw) : null;
    const values: Partial<CheckInExtraction> = {};
    if (sbp !== null && Number.isFinite(sbp) && sbp >= 50 && sbp <= 260) values.sbp = sbp;
    if (spo2 !== null && Number.isFinite(spo2) && spo2 >= 50 && spo2 <= 100) values.spo2 = spo2;
    addLine('you', values.sbp || values.spo2
      ? `BP ${values.sbp ?? '—'} · oxygen ${values.spo2 ?? '—'}`
      : "I'll skip that one");
    handleTurn(applyDeterministicAnswer(callState, values), current);
  }

  const minutes = String(Math.floor(seconds / 60)).padStart(1, '0');
  const secs = String(seconds % 60).padStart(2, '0');
  const currentQuestion = callState.phase !== 'complete' ? callState.phase : null;
  const chips = currentQuestion ? QUICK_ANSWERS[currentQuestion as ScriptQuestionId] : undefined;
  const numericQuestion = currentQuestion === 'q2_weight' || currentQuestion === 'q8_devices';
  const showVoiceStatus = voiceSupported && phase === 'active' && !result && !offlineMode;

  return (
    <section className="rounded-xl border border-emerald-200 bg-white" data-testid="sandbox-live-call" aria-label="Simulated incoming check-in call">
      {/* Hidden element that plays the assistant's clips and synthesized lines. */}
      <audio ref={audioRef} data-testid="live-call-audio" />

      <div className="flex items-center justify-between gap-2 rounded-t-xl bg-emerald-50 px-3 py-2">
        <p className="text-xs font-bold text-emerald-950">
          {phase === 'ringing' ? 'Incoming call · HEARTLAND check-in' : `Check-in call · ${minutes}:${secs}`} · Simulation
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
          <p className="text-sm font-bold text-slate-950">Automated daily check-in calling…</p>
          <p className="text-xs leading-5 text-slate-600">
            You&apos;ll play the synthetic patient. The assistant speaks out loud
            {voiceSupported ? ' — answer by talking, typing, or tapping' : ''}; preset clinical rules decide the outcome.
          </p>
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
              <Button size="sm" variant="outline" onClick={() => { const audio = audioRef.current; if (audio) { audio.src = needsTap; void audio.play().catch(() => undefined); setNeedsTap(null); } }}>
                <Volume2 className="mr-1 size-4" /> Play assistant audio
              </Button>
            </div>
          )}

          {result && (
            <div className={`mx-3 mb-3 rounded-lg border p-3 text-xs leading-5 ${RESULT_STYLES[result.disposition].box}`} data-testid="live-call-result">
              <p className="font-bold">{RESULT_STYLES[result.disposition].title}</p>
              {result.redFlags.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {result.redFlags.map((flag) => <li key={flag.id}>{flag.message} — {flag.action}</li>)}
                </ul>
              )}
              <p className="mt-1">Disposition set by the registered clinical rules, never by the AI.</p>
            </div>
          )}

          {!result && currentQuestion && (
            <div className="space-y-2 border-t p-3">
              {chips && (
                <div className="flex flex-wrap gap-2" data-testid="live-call-chips">
                  {chips.map((chip) => (
                    <Button key={chip.label} size="sm" variant="outline" disabled={busy} onClick={() => answerWithChip(chip.values, chip.label)}>
                      {chip.label}
                    </Button>
                  ))}
                </div>
              )}
              {numericQuestion && (
                <form className="flex flex-wrap items-end gap-2 text-xs" onSubmit={(event) => { event.preventDefault(); submitNumbers(new FormData(event.currentTarget)); }} data-testid="live-call-numbers">
                  {currentQuestion === 'q2_weight' ? (
                    <label className="flex flex-col gap-1 font-semibold">Weight (lbs)
                      <input name="weight" type="number" min={50} max={500} step="0.1" required className="min-h-11 w-28 rounded-lg border border-slate-300 px-2 font-normal" />
                    </label>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1 font-semibold">Systolic BP
                        <input name="sbp" type="number" min={50} max={260} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 font-normal" />
                      </label>
                      <label className="flex flex-col gap-1 font-semibold">Oxygen %
                        <input name="spo2" type="number" min={50} max={100} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 font-normal" />
                      </label>
                    </>
                  )}
                  <Button type="submit" size="sm" variant="outline" disabled={busy} className="min-h-11">
                    {currentQuestion === 'q8_devices' ? 'Send / skip' : 'Send'}
                  </Button>
                </form>
              )}
              {!offlineMode && !numericQuestion && (
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
