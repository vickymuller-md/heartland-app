'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { createInitialState, emptyExtraction, finalizeCheckIn } from '@/lib/sandbox-ai/engine';
import { EMERGENCY_911_MESSAGE, FALLBACK_NOTICE, INTRO_MESSAGES } from '@/lib/sandbox-ai/script';
import type { CheckInDisposition, CheckInExtraction, CheckInState, CheckInTurnResponse } from '@/lib/sandbox-ai/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag, SymptomSeverity } from '@/lib/vitals/types';
import { Button } from '@/components/ui/button';

interface ChatMessage { role: 'assistant' | 'visitor'; text: string }
interface CheckInResult { disposition: CheckInDisposition; redFlags: RedFlag[] }

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
  const [messages, setMessages] = useState<ChatMessage[]>(
    INTRO_MESSAGES.map((text) => ({ role: 'assistant', text })),
  );
  const [checkInState, setCheckInState] = useState<CheckInState>(() => createInitialState(patient.id));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'chat' | 'form'>('chat');
  const [result, setResult] = useState<CheckInResult | null>(null);
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

  function completeWith(disposition: CheckInDisposition, redFlags: RedFlag[]) {
    setResult({ disposition, redFlags });
    trackAiEvent('ai_checkin_completed', Math.min(Date.now() - startedAt.current, 3_600_000));
    if (disposition !== 'routine') trackAiEvent('ai_escalation_demonstrated');
    onComplete();
  }

  function switchToForm() {
    setMode('form');
    setMessages((current) => [...current, { role: 'assistant', text: FALLBACK_NOTICE }]);
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
    const chestPain = formData.get('chestPain') === 'yes';
    const numberOrNull = (name: string, min: number, max: number) => {
      const raw = String(formData.get(name) ?? '').trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value >= min && value <= max ? value : null;
    };
    const severity = (name: string) => Number(formData.get(name) ?? 0) as SymptomSeverity;
    const extraction: CheckInExtraction = {
      ...emptyExtraction(),
      chestPainOrSyncope: chestPain,
      weightLbs: numberOrNull('weight', 50, 500),
      dyspnea: severity('breathing'),
      edema: severity('swelling'),
      orthopnea: formData.get('pillows') === 'yes',
      fatigue: severity('energy'),
      adherence: (formData.get('meds') as CheckInExtraction['adherence']) ?? null,
      sbp: numberOrNull('sbp', 50, 260),
      spo2: numberOrNull('spo2', 50, 100),
    };
    if (chestPain) {
      // Same deterministic short-circuit the server engine applies.
      setMessages((current) => [...current, { role: 'assistant', text: EMERGENCY_911_MESSAGE }]);
      completeWith('emergency', []);
      return;
    }
    const finished = finalizeCheckIn({
      patientId: patient.id, phase: 'q8_devices', extraction, reasksUsed: {}, turnCount: 0,
    });
    setMessages((current) => [
      ...current,
      ...finished.assistantMessages.map((text) => ({ role: 'assistant' as const, text })),
    ]);
    completeWith(finished.disposition ?? 'routine', finished.redFlags);
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-white" data-testid="sandbox-ai-checkin" aria-label="Automated check-in demonstration">
      <div className="flex items-center justify-between gap-2 rounded-t-xl bg-blue-50 px-3 py-2">
        <p className="text-xs font-bold text-blue-950">Automated Check-In (AI-assisted) · Demonstration</p>
        <button type="button" onClick={onClose} aria-label="Close check-in" className="flex size-8 items-center justify-center rounded-full text-blue-900 hover:bg-blue-100"><X className="size-4" /></button>
      </div>

      <div ref={logRef} className="max-h-72 space-y-2 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Check-in conversation">
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
          {result.redFlags.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {result.redFlags.map((flag) => <li key={flag.id}>{flag.message} — {flag.action}</li>)}
            </ul>
          )}
          <p className="mt-1">Disposition set by the registered clinical rules, never by the AI. A provider work item appears on the care-team side.</p>
        </div>
      )}

      {!result && mode === 'chat' && (
        <form className="flex items-center gap-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); void sendChatMessage(); }}>
          <label className="sr-only" htmlFor="sandbox-ai-input">Type your check-in answer</label>
          <input
            id="sandbox-ai-input"
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"
            value={input}
            maxLength={500}
            placeholder="Type your answer…"
            onChange={(event) => setInput(event.target.value)}
            disabled={busy}
          />
          <Button type="submit" className="min-h-11" disabled={busy || input.trim().length === 0} aria-label="Send answer"><Send className="size-4" /></Button>
        </form>
      )}

      {!result && mode === 'form' && (
        <form
          className="space-y-2 border-t p-3 text-xs"
          data-testid="sandbox-ai-form"
          onSubmit={(event) => { event.preventDefault(); submitForm(new FormData(event.currentTarget)); }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-semibold">Chest pain or fainting since yesterday?
              <select name="chestPain" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="no"><option value="no">No</option><option value="yes">Yes</option></select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Weight this morning (lbs)
              <input name="weight" type="number" min={50} max={500} step="0.1" required className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" />
            </label>
            <label className="flex flex-col gap-1 font-semibold">Breathing today
              <select name="breathing" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="0">{BREATHING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">New or worse swelling
              <select name="swelling" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="0">{SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Needed extra pillows to sleep?
              <select name="pillows" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="no"><option value="no">No</option><option value="yes">Yes</option></select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">Energy vs normal
              <select name="energy" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="0">{SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} fatigue</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 font-semibold">All medicines taken?
              <select name="meds" className="min-h-11 rounded-lg border border-slate-300 px-2 font-normal" defaultValue="yes"><option value="yes">Yes, all taken</option><option value="missed_some">Missed some</option><option value="no">No</option></select>
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
