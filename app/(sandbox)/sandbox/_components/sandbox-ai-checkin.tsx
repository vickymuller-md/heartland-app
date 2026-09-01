'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Volume2, VolumeX, X } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { callPromptsFor } from '@/lib/sandbox-ai/call-prompts';
import { createInitialState, emptyExtraction, finalizeCheckIn } from '@/lib/sandbox-ai/engine';
import { emergencyMessageFor, fallbackNoticeFor, introMessagesFor } from '@/lib/sandbox-ai/script';
import type { CallLocale, CheckInDisposition, CheckInExtraction, CheckInState, CheckInTurnResponse } from '@/lib/sandbox-ai/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag, SymptomSeverity } from '@/lib/vitals/types';
import { Button } from '@/components/ui/button';
import { ExplainRuleButton } from './explain-rule';
import { useAssistantAudioQueue } from './use-assistant-audio-queue';

interface ChatMessage { role: 'assistant' | 'visitor'; text: string }
interface CheckInResult {
  disposition: CheckInDisposition;
  redFlags: RedFlag[];
  basis: 'registered_rules' | 'missing_data';
  detail?: string;
}

function trackAiEvent(eventName: ProductEventInput['eventName'], durationMs?: number) {
  void trackProductEvent({ eventName, area: 'sandbox', durationMs, ...getPublicDisseminationContext() });
}

const SEVERITY_OPTIONS: Array<{ value: SymptomSeverity; label: string }> = [
  { value: 0, label: 'None' }, { value: 1, label: 'Mild' }, { value: 2, label: 'Moderate' }, { value: 3, label: 'Severe' },
];
const BREATHING_OPTIONS: Array<{ value: SymptomSeverity; label: string }> = [
  { value: 0, label: 'Fine' },
  { value: 1, label: 'Short of breath with heavy activity' },
  { value: 2, label: 'Short of breath with activity' },
  { value: 3, label: 'Short of breath even at rest' },
];

const RESULT_STYLES: Record<CheckInDisposition, { box: string; title: string }> = {
  emergency: { box: 'border-red-300 bg-red-50 text-red-950', title: 'Emergency pathway demonstrated' },
  escalated: { box: 'border-amber-300 bg-amber-50 text-amber-950', title: 'Escalated to human review' },
  routine: { box: 'border-emerald-300 bg-emerald-50 text-emerald-950', title: 'Routine — stays in the monitoring queue' },
};

export function SandboxAiCheckIn({ patient, onComplete, onClose }: {
  patient: SandboxPatient;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [locale, setLocale] = useState<CallLocale>('en');
  const [messages, setMessages] = useState<ChatMessage[]>(
    introMessagesFor('en').map((text) => ({ role: 'assistant', text })),
  );
  const [checkInState, setCheckInState] = useState<CheckInState>(() => createInitialState(patient.id));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'chat' | 'form'>('chat');
  const [result, setResult] = useState<CheckInResult | null>(null);
  // Voice is opt-in in the chat (the simulated call is the voice-first surface).
  const [voiceOn, setVoiceOn] = useState(false);
  const { audioRef, needsTap, enqueue, resumeAfterTap } = useAssistantAudioQueue();
  const startedTracked = useRef(false);
  const startedAt = useRef(Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep the newest message in view; the log pane has its own overflow.
    // scrollTop assignment (not scrollTo) also works under jsdom.
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy, result]);

  function trackStartOnce() {
    if (startedTracked.current) return;
    startedTracked.current = true;
    trackAiEvent('ai_checkin_started');
  }

  function chooseLocale(next: CallLocale) {
    // Language can only change before the first answer of the conversation.
    if (startedTracked.current || next === locale) return;
    setLocale(next);
    setCheckInState(createInitialState(patient.id, 'daily_checkin', next));
    setMessages(introMessagesFor(next).map((text) => ({ role: 'assistant', text })));
  }

  function completeWith(
    disposition: CheckInDisposition,
    redFlags: RedFlag[],
    basis: CheckInResult['basis'] = 'registered_rules',
    detail?: string,
  ) {
    setResult({ disposition, redFlags, basis, detail });
    trackAiEvent('ai_checkin_completed', Math.min(Date.now() - startedAt.current, 3_600_000));
    if (disposition !== 'routine') trackAiEvent('ai_escalation_demonstrated');
    onComplete();
  }

  function switchToForm() {
    setMode('form');
    setMessages((current) => [...current, { role: 'assistant', text: fallbackNoticeFor(locale) }]);
    trackAiEvent('ai_checkin_fallback');
  }

  async function sendChatMessage() {
    const message = input.trim();
    if (!message || busy || result) return;
    trackStartOnce();
    setInput('');
    setBusy(true);
    setMessages((current) => [...current, { role: 'visitor', text: message }]);
    try {
      const response = await fetch('/api/sandbox-ai/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: checkInState,
          message,
          anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
          wantSpeech: voiceOn,
        }),
      });
      if (!response.ok && response.status !== 429) throw new Error('request failed');
      const turn = (await response.json()) as Partial<CheckInTurnResponse> & { fallback?: boolean };
      if (turn.fallback || !turn.state) {
        switchToForm();
        return;
      }
      setMessages((current) => [
        ...current,
        ...(turn.assistantMessages ?? []).map((text) => ({ role: 'assistant' as const, text })),
      ]);
      if (voiceOn) {
        const prompts = callPromptsFor('daily_checkin', locale);
        for (const item of turn.speech ?? []) {
          if (item?.kind === 'clip') {
            const clip = prompts[item.clipId];
            if (clip) enqueue(clip.audioSrc);
          } else if (item?.kind === 'audio') {
            enqueue(`data:audio/mpeg;base64,${item.mp3Base64}`);
          }
        }
      }
      setCheckInState(turn.state);
      if (turn.done && turn.disposition) completeWith(turn.disposition, turn.redFlags ?? []);
    } catch {
      switchToForm();
    } finally {
      setBusy(false);
    }
  }

  function submitForm(formData: FormData) {
    if (result) return;
    trackStartOnce();
    const chestPainValue = String(formData.get('chestPain') ?? '');
    const chestPain = chestPainValue === 'yes' ? true : chestPainValue === 'no' ? false : null;
    const numberOrNull = (name: string, min: number, max: number) => {
      const raw = String(formData.get(name) ?? '').trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= min && value <= max ? value : null;
    };
    const severityOrNull = (name: string): SymptomSeverity | null => {
      const raw = String(formData.get(name) ?? '');
      if (!['0', '1', '2', '3'].includes(raw)) return null;
      return Number(raw) as SymptomSeverity;
    };
    const yesNoOrNull = (name: string): boolean | null => {
      const raw = String(formData.get(name) ?? '');
      return raw === 'yes' ? true : raw === 'no' ? false : null;
    };
    const adherenceValue = String(formData.get('meds') ?? '');
    const adherence = ['yes', 'missed_some', 'no'].includes(adherenceValue)
      ? adherenceValue as CheckInExtraction['adherence']
      : null;
    const extraction: CheckInExtraction = {
      ...emptyExtraction(),
      chestPainOrSyncope: chestPain,
      weightLbs: numberOrNull('weight', 50, 500),
      dyspnea: severityOrNull('breathing'),
      edema: severityOrNull('swelling'),
      orthopnea: yesNoOrNull('pillows'),
      fatigue: severityOrNull('energy'),
      adherence,
      sbp: numberOrNull('sbp', 50, 260),
      spo2: numberOrNull('spo2', 50, 100),
    };
    if (chestPain === true) {
      // Same deterministic short-circuit the server engine applies.
      setMessages((current) => [...current, { role: 'assistant', text: emergencyMessageFor(locale) }]);
      completeWith('emergency', []);
      return;
    }
    const requiredAnswers: Array<[string, unknown]> = [
      ['chest pain/fainting', extraction.chestPainOrSyncope],
      ['weight', extraction.weightLbs],
      ['breathing', extraction.dyspnea],
      ['swelling', extraction.edema],
      ['sleeping position', extraction.orthopnea],
      ['energy', extraction.fatigue],
      ['medications', extraction.adherence],
    ];
    const missing = requiredAnswers.filter(([, value]) => value === null).map(([label]) => label);
    if (missing.length > 0) {
      const detail = locale === 'es'
        ? `Chequeo incompleto — faltan respuestas sobre: ${missing.join(', ')}. Se requiere revisión humana.`
        : `Incomplete check-in — unanswered items require human review: ${missing.join(', ')}.`;
      setMessages((current) => [...current, { role: 'assistant', text: detail }]);
      completeWith('escalated', [], 'missing_data', detail);
      return;
    }
    const finished = finalizeCheckIn({
      patientId: patient.id, scriptId: 'daily_checkin', locale,
      phase: 'q8_devices', extraction, reasksUsed: {}, turnCount: 0,
    });
    setMessages((current) => [
      ...current,
      ...finished.assistantMessages.map((text) => ({ role: 'assistant' as const, text })),
    ]);
    completeWith(finished.disposition ?? 'routine', finished.redFlags);
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-white" data-testid="sandbox-ai-checkin" aria-label="Automated check-in demonstration">
      {/* Hidden element that plays the assistant's clips and synthesized lines. */}
      <audio ref={audioRef} data-testid="checkin-audio" />

      <div className="flex items-center justify-between gap-2 rounded-t-xl bg-blue-50 px-3 py-2">
        <p className="text-xs font-bold text-blue-950">Automated Check-In (AI-assisted) · Demonstration</p>
        <div className="flex items-center gap-1">
          {mode === 'chat' && !result && (
            <div className="mr-1 flex gap-1" role="group" aria-label="Conversation language">
              {(['en', 'es'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={locale === option}
                  data-testid={`checkin-locale-${option}`}
                  onClick={() => chooseLocale(option)}
                  className={`min-h-8 rounded-full px-2.5 text-[11px] font-semibold ${locale === option ? 'bg-blue-700 text-white' : 'bg-white text-blue-900 hover:bg-blue-100'}`}
                >
                  {option === 'en' ? 'EN' : 'ES'}
                </button>
              ))}
            </div>
          )}
          {mode === 'chat' && !result && (
            <button
              type="button"
              onClick={() => setVoiceOn((current) => !current)}
              aria-pressed={voiceOn}
              aria-label={voiceOn ? 'Turn assistant voice off' : 'Turn assistant voice on'}
              data-testid="checkin-voice-toggle"
              className={`flex size-8 items-center justify-center rounded-full ${voiceOn ? 'bg-blue-100 text-blue-900' : 'text-blue-900 hover:bg-blue-100'}`}
            >
              {voiceOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close check-in" className="flex size-8 items-center justify-center rounded-full text-blue-900 hover:bg-blue-100"><X className="size-4" /></button>
        </div>
      </div>

      {needsTap && voiceOn && !result && (
        <div className="px-3 pt-2">
          <Button size="sm" variant="outline" onClick={resumeAfterTap}>
            <Volume2 className="mr-1 size-4" /> Play assistant audio
          </Button>
        </div>
      )}

      <div ref={logRef} className="max-h-72 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Check-in conversation" lang={locale === 'es' ? 'es-US' : 'en-US'}>
        {messages.map((message, index) => (
          <p key={index} className={message.role === 'assistant'
            ? 'mr-6 rounded-lg rounded-bl-none bg-slate-100 p-2.5 text-xs leading-5 text-slate-900'
            : 'ml-6 rounded-lg rounded-br-none bg-blue-600 p-2.5 text-xs leading-5 text-white'}>
            {message.text}
          </p>
        ))}
        {busy && <p className="mr-6 rounded-lg bg-slate-100 p-2.5 text-xs text-slate-600">Structuring your answer…</p>}
      </div>

      {result && (
        <div className={`mx-3 mb-3 rounded-lg border p-3 text-xs leading-5 ${RESULT_STYLES[result.disposition].box}`} data-testid="sandbox-ai-result">
          <p className="font-bold">{RESULT_STYLES[result.disposition].title}</p>
          {result.detail && <p className="mt-1 font-semibold">{result.detail}</p>}
          {result.redFlags.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {result.redFlags.map((flag) => (
                <li key={flag.id}>
                  {flag.message} — {flag.action}
                  <ExplainRuleButton ruleId={flag.id} extraction={checkInState.extraction} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1">
            {result.basis === 'missing_data'
              ? 'Incomplete answers follow the demonstration’s fail-safe path to human review; AI did not infer negative answers.'
              : 'Disposition set by the registered clinical rules, never by the AI.'}
            {' '}In a connected controlled workspace this would create a provider work item; this public sandbox creates no clinical record.
          </p>
        </div>
      )}

      {!result && mode === 'chat' && (
        <div className="border-t p-3">
          <p id="sandbox-ai-synthetic-input-note" className="mb-2 text-[11px] font-semibold leading-4 text-amber-800">
            Synthetic answers only — do not enter real patient, personal, or health information.
          </p>
          <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); void sendChatMessage(); }}>
            <label className="sr-only" htmlFor="sandbox-ai-input">Type your check-in answer</label>
            <input
              id="sandbox-ai-input"
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
              value={input}
              maxLength={500}
              aria-describedby="sandbox-ai-synthetic-input-note"
              placeholder="Type a synthetic answer…"
              onChange={(event) => setInput(event.target.value)}
              disabled={busy}
            />
            <Button type="submit" className="min-h-11" disabled={busy || input.trim().length === 0} aria-label="Send answer"><Send className="size-4" /></Button>
          </form>
        </div>
      )}

      {!result && mode === 'form' && (
        <form
          className="space-y-2 border-t p-3 text-xs"
          data-testid="sandbox-ai-form"
          onSubmit={(event) => { event.preventDefault(); submitForm(new FormData(event.currentTarget)); }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-semibold">Chest pain or fainting since yesterday?
              <select name="chestPain" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option><option value="no">No</option><option value="yes">Yes</option></select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Weight this morning (lbs)
              <input name="weight" type="number" min={50} max={500} step="0.1" placeholder="Not answered" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" />
            </label>
            <label className="flex flex-col gap-1 font-semibold">Breathing today
              <select name="breathing" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option>{BREATHING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">New or worse swelling
              <select name="swelling" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option>{SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Needed extra pillows to sleep?
              <select name="pillows" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option><option value="no">No</option><option value="yes">Yes</option></select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Energy vs normal
              <select name="energy" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option>{SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} fatigue</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">All medicines taken?
              <select name="meds" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue=""><option value="">Not answered</option><option value="yes">Yes, all taken</option><option value="missed_some">Missed some</option><option value="no">No</option></select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Systolic BP (optional)
              <input name="sbp" type="number" min={50} max={260} className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" />
            </label>
            <label className="flex flex-col gap-1 font-semibold">Oxygen % (optional)
              <input name="spo2" type="number" min={50} max={100} className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" />
            </label>
          </div>
          <Button type="submit" className="min-h-11 w-full">Submit check-in</Button>
        </form>
      )}

      <p className="border-t px-3 py-2 text-[11px] leading-4 text-slate-500">
        Synthetic demonstration only. This assistant collects check-in answers and never provides
        medical advice. Escalation is decided by preset clinical rules, reviewed by humans. Not for
        real patient use. <span className="font-semibold">AI structures the conversation · preset clinical rules decide escalation.</span>
      </p>
    </section>
  );
}
