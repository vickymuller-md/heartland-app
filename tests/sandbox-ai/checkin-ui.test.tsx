import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { SandboxAiCheckIn } from '@/app/(sandbox)/sandbox/_components/sandbox-ai-checkin';
import { SandboxPatientView } from '@/app/(sandbox)/sandbox/_components/sandbox-patient-view';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { createInitialState, finalizeCheckIn } from '@/lib/sandbox-ai/engine';
import type { CallLocale, CheckInTurnResponse } from '@/lib/sandbox-ai/types';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const james = SANDBOX_PATIENTS.find((patient) => patient.id === 'demo-james')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-13T16:00:00.000Z'));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function sendAnswer(value = 'Synthetic answer') {
  fireEvent.change(screen.getByLabelText('Type your check-in answer'), { target: { value } });
  fireEvent.submit(screen.getByLabelText('Type your check-in answer').closest('form')!);
}

function completedTurn(locale: CallLocale = 'en'): CheckInTurnResponse {
  const state = createInitialState(james.id, 'daily_checkin', locale);
  return finalizeCheckIn({ ...state, extraction: {
    ...state.extraction, chestPainOrSyncope: false, weightLbs: 188,
    dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0, adherence: 'yes',
  } });
}

function trackedEventNames(): string[] {
  return vi.mocked(trackProductEvent).mock.calls.map(([input]) => input.eventName);
}

async function reachFallbackForm() {
  // The chat endpoint reports fallback (feature disabled) -> form mode.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ fallback: true }),
  }));
  fireEvent.change(screen.getByLabelText('Type your check-in answer'), { target: { value: 'no chest pain' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
  await waitFor(() => expect(screen.getByTestId('sandbox-ai-form')).toBeInTheDocument());
}

function submitForm(fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
  }
  fireEvent.submit(screen.getByTestId('sandbox-ai-form'));
}

const COMPLETE_STABLE_ANSWERS = {
  'Chest pain or fainting': 'no',
  'Breathing today': '0',
  'New or worse swelling': '0',
  'Needed extra pillows': 'no',
  'Energy vs normal': '0',
  'All medicines taken': 'yes',
};

describe('SandboxAiCheckIn — deterministic fallback form', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={onClose} />);
  });

  it('completes a stable check-in as routine with the same rule engine', async () => {
    await reachFallbackForm();
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '188' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Routine');
    expect(screen.getByRole('log').textContent).toContain('Nothing you reported needs urgent attention');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(trackedEventNames()).toEqual(
      expect.arrayContaining(['ai_checkin_started', 'ai_checkin_fallback', 'ai_checkin_completed']),
    );
    expect(trackedEventNames()).not.toContain('ai_escalation_demonstrated');
  });

  it('escalates a weight-gain trend with the registered red-flag texts', async () => {
    await reachFallbackForm();
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '194' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Escalated to human review');
    expect(screen.getByTestId('sandbox-ai-result').textContent).toContain('Weight gain of 5+ lbs in 1 week detected');
    expect(trackedEventNames()).toContain('ai_escalation_demonstrated');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('routes chest pain to the emergency template without running trend rules', async () => {
    await reachFallbackForm();
    fireEvent.change(screen.getByLabelText(/Chest pain or fainting/), { target: { value: 'yes' } });
    submitForm({ 'Weight this morning': '188' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Emergency pathway demonstrated');
    expect(screen.getByRole('log').textContent).toContain('call 911');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('never converts unanswered fields into negative answers and routes missing data to review', async () => {
    await reachFallbackForm();
    submitForm({ 'Weight this morning': '188' });

    const result = await screen.findByTestId('sandbox-ai-result');
    expect(result).toHaveTextContent('Escalated to human review');
    expect(result).toHaveTextContent('unanswered items require human review');
    expect(result).toHaveTextContent('AI did not infer negative answers');
    expect(result).not.toHaveTextContent('Routine');
  });

  it('places the no-real-data warning next to free text and marks Spanish conversation language', () => {
    const input = screen.getByLabelText('Type your check-in answer');
    expect(input).toHaveAttribute('aria-describedby', 'sandbox-ai-synthetic-input-note');
    expect(screen.getByText(/do not enter real patient, personal, or health information/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('checkin-locale-es'));
    expect(screen.getByRole('log')).toHaveAttribute('lang', 'es-US');
  });
});

describe('SandboxPatientView — mutually exclusive check-in experiences', () => {
  it('replaces the active daily call when titration opens, then replaces it with chat check-in', () => {
    render(<SandboxPatientView patient={james} patientCheckIns={[]} onCheckIn={vi.fn()} />);

    fireEvent.click(screen.getByTestId('open-live-call'));
    expect(screen.getAllByTestId('sandbox-live-call')).toHaveLength(1);
    expect(screen.getByText(/Automated daily check-in calling/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-titration-call'));
    expect(screen.getAllByTestId('sandbox-live-call')).toHaveLength(1);
    expect(screen.getByText(/Titration follow-up calling/i)).toBeInTheDocument();
    expect(screen.queryByText(/Automated daily check-in calling/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Complete symptom check-in/ }));
    expect(screen.getByTestId('sandbox-ai-checkin')).toBeInTheDocument();
    expect(screen.queryByTestId('sandbox-live-call')).toBeNull();
  });

  it('moves focus into the opened panel and returns it to the opener on close', () => {
    render(<SandboxPatientView patient={james} patientCheckIns={[]} onCheckIn={vi.fn()} />);

    const checkInOpener = screen.getByRole('button', { name: /Complete symptom check-in/ });
    fireEvent.click(checkInOpener);
    expect(screen.getByTestId('sandbox-ai-checkin')).toHaveFocus();
    expect(screen.getByRole('log')).toHaveAttribute('tabindex', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Close check-in' }));
    expect(screen.queryByTestId('sandbox-ai-checkin')).toBeNull();
    expect(checkInOpener).toHaveFocus();

    fireEvent.click(screen.getByTestId('open-live-call'));
    expect(screen.getByTestId('sandbox-live-call')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    expect(screen.queryByTestId('sandbox-live-call')).toBeNull();
    expect(screen.getByTestId('open-live-call')).toHaveFocus();

    // Replacing one experience with another keeps focus in the new panel.
    fireEvent.click(screen.getByTestId('open-titration-call'));
    expect(screen.getByTestId('sandbox-live-call')).toHaveFocus();
    fireEvent.click(checkInOpener);
    expect(screen.getByTestId('sandbox-ai-checkin')).toHaveFocus();
  });
});

describe('SandboxAiCheckIn — completed data and request lifetime', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['en', 'es'] as const)('explains the completed fallback values, not the previous %s chat extraction', async (locale) => {
    const onComplete = vi.fn();
    const oldState = createInitialState(james.id, 'daily_checkin', locale);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        state: { ...oldState, phase: 'q2_weight', extraction: { ...oldState.extraction, weightLbs: 188, sbp: 110, spo2: 96, dyspnea: 1 } },
        assistantMessages: ['Synthetic earlier answer recorded.'], done: false, disposition: null, redFlags: [], fallback: false,
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ fallback: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ kind: 'explain_rule', explanation: 'Synthetic explanation of the registered rule.' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={vi.fn()} />);
    if (locale === 'es') fireEvent.click(screen.getByTestId('checkin-locale-es'));
    sendAnswer();
    await screen.findByText('Synthetic earlier answer recorded.');
    sendAnswer('Synthetic transport fallback');
    await screen.findByTestId('sandbox-ai-form');
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '194' });
    expect(screen.getByTestId('sandbox-ai-result')).toHaveTextContent('Weight gain of 5+ lbs in 1 week detected');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('explain-rule-button-weight_gain_5lb_7d'));
    await screen.findByTestId('explain-rule-weight_gain_5lb_7d');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/sandbox-ai/assist');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).input).toEqual({
      ruleId: 'weight_gain_5lb_7d', values: { weightLbs: 194, sbp: null, spo2: null, dyspnea: 0 },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['response', 'json', 'failure'] as const)('ignores a late %s after explicit close, even when the transport ignores abort', async (stage) => {
    const response = deferred<Response>();
    const json = deferred<CheckInTurnResponse>();
    const jsonReader = vi.fn(() => json.promise);
    const fetchMock = vi.fn(() => stage === 'json'
      ? Promise.resolve({ ok: true, status: 200, json: jsonReader }) : response.promise);
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = vi.fn();
    const onClose = vi.fn();
    render(<StrictMode><SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={onClose} /></StrictMode>);
    fireEvent.click(screen.getByTestId('checkin-voice-toggle'));
    sendAnswer();
    if (stage === 'json') await waitFor(() => expect(jsonReader).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal;
    fireEvent.click(screen.getByRole('button', { name: 'Close check-in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close check-in' }));
    const playsAfterClose = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    const turn = { ...completedTurn(), speech: [{ kind: 'audio' as const, mp3Base64: 'c3ludGhldGlj' }] };
    await act(async () => {
      if (stage === 'failure') response.reject(new TypeError('Synthetic offline failure'));
      else if (stage === 'json') json.resolve(turn);
      else response.resolve({ ok: true, status: 200, json: async () => turn } as Response);
    });
    expect.soft(signal?.aborted).toBe(true);
    expect.soft(onClose).toHaveBeenCalledTimes(1);
    expect.soft(onComplete).not.toHaveBeenCalled();
    expect.soft(trackedEventNames()).toEqual(['ai_checkin_started']);
    expect.soft(screen.queryByTestId('sandbox-ai-result')).not.toBeInTheDocument();
    expect.soft(screen.queryByTestId('sandbox-ai-form')).not.toBeInTheDocument();
    expect.soft(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playsAfterClose);
  });

  it('keeps a new StrictMode mount usable while discarding the previous mount’s pending response', async () => {
    const oldResponse = deferred<Response>();
    const fetchMock = vi.fn().mockImplementationOnce(() => oldResponse.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => completedTurn('es') });
    vi.stubGlobal('fetch', fetchMock);
    const oldComplete = vi.fn();
    const newComplete = vi.fn();
    const previous = render(<StrictMode><SandboxAiCheckIn patient={james} onComplete={oldComplete} onClose={vi.fn()} /></StrictMode>);
    sendAnswer();
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal | undefined;
    previous.unmount();
    render(<StrictMode><SandboxAiCheckIn patient={james} onComplete={newComplete} onClose={vi.fn()} /></StrictMode>);
    fireEvent.click(screen.getByTestId('checkin-locale-es'));
    sendAnswer('Respuesta sintética');
    await screen.findByTestId('sandbox-ai-result');
    await act(async () => oldResponse.resolve({ ok: true, status: 200, json: async () => completedTurn() } as Response));
    expect.soft(oldSignal?.aborted).toBe(true);
    expect.soft(oldComplete).not.toHaveBeenCalled();
    expect.soft(newComplete).toHaveBeenCalledTimes(1);
    expect.soft(trackedEventNames().filter((name) => name === 'ai_checkin_completed')).toHaveLength(1);
    expect(screen.getByRole('log')).toHaveAttribute('lang', 'es-US');
  });

  it('admits one request and one completion when submit fires twice before React updates', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => completedTurn() });
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = vi.fn();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Type your check-in answer'), { target: { value: '  Synthetic answer  ' } });
    const form = screen.getByLabelText('Type your check-in answer').closest('form')!;
    act(() => { fireEvent.submit(form); fireEvent.submit(form); });
    await screen.findByTestId('sandbox-ai-result');
    expect.soft(fetchMock).toHaveBeenCalledTimes(1);
    expect.soft(onComplete).toHaveBeenCalledTimes(1);
    expect.soft(trackedEventNames()).toEqual(['ai_checkin_started', 'ai_checkin_completed']);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ state: createInitialState(james.id), message: 'Synthetic answer', wantSpeech: false });
    expect(Object.keys(payload).sort()).toEqual(['anonymousSessionId', 'message', 'state', 'wantSpeech']);
  });

  it('completes a fallback form only once when submitted twice synchronously', async () => {
    const onComplete = vi.fn();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={vi.fn()} />);
    await reachFallbackForm();
    act(() => {
      submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '188' });
      fireEvent.submit(screen.getByTestId('sandbox-ai-form'));
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(trackedEventNames().filter((name) => name === 'ai_checkin_completed')).toHaveLength(1);
  });

  it.each(['network', 'http', 'rate-limit', 'invalid-json'] as const)('preserves the local fallback for a current %s failure', async (failure) => {
    const fetchMock = vi.fn();
    if (failure === 'network') fetchMock.mockRejectedValue(new TypeError('Synthetic offline failure'));
    else fetchMock.mockResolvedValue({
      ok: failure === 'invalid-json', status: failure === 'rate-limit' ? 429 : failure === 'http' ? 503 : 200,
      json: failure === 'invalid-json'
        ? async () => { throw new SyntaxError('Synthetic invalid JSON'); }
        : async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onComplete = vi.fn();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={vi.fn()} />);
    sendAnswer();
    await screen.findByTestId('sandbox-ai-form');
    expect(trackedEventNames()).toEqual(['ai_checkin_started', 'ai_checkin_fallback']);
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '188' });
    expect(screen.getByTestId('sandbox-ai-result')).toHaveTextContent('Routine');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each([60_000, 3_700_000])('preserves the valid completion duration and existing cap after %i ms', async (duration) => {
    const response = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => response.promise));
    render(<SandboxAiCheckIn patient={james} onComplete={vi.fn()} onClose={vi.fn()} />);
    sendAnswer();
    vi.setSystemTime(new Date(Date.now() + duration));
    await act(async () => response.resolve({ ok: true, status: 200, json: async () => completedTurn() } as Response));
    const completions = vi.mocked(trackProductEvent).mock.calls.map(([input]) => input)
      .filter((input) => input.eventName === 'ai_checkin_completed');
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({ area: 'sandbox', durationMs: Math.min(duration, 3_600_000) });
  });

  it('contains unavailable telemetry without interrupting fallback, completion or duplicating events', async () => {
    const trackingReceipt = () => {
      const receipt = deferred<void>();
      return { ...receipt, catchSpy: vi.spyOn(receipt.promise, 'catch') };
    };
    const receipts: Array<ReturnType<typeof trackingReceipt>> = [];
    vi.mocked(trackProductEvent).mockImplementation(() => {
      const receipt = trackingReceipt();
      receipts.push(receipt);
      return receipt.promise;
    });
    const onComplete = vi.fn();
    try {
      render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={vi.fn()} />);
      await reachFallbackForm();
      expect(receipts).toHaveLength(2);
      // Prove the product attached a rejection handler before rejecting. A RED
      // assertion exits through finally and resolves pending promises instead.
      for (const receipt of receipts) expect(receipt.catchSpy).toHaveBeenCalledTimes(1);
      await act(async () => {
        for (const receipt of receipts) receipt.reject(new Error('Synthetic telemetry offline'));
        await Promise.allSettled(receipts.map((receipt) => receipt.promise));
      });
      expect(screen.getByTestId('sandbox-ai-form')).toBeInTheDocument();
      expect(onComplete).not.toHaveBeenCalled();
      submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '188' });
      expect(receipts).toHaveLength(3);
      expect(receipts[2].catchSpy).toHaveBeenCalledTimes(1);
      await act(async () => {
        receipts[2].reject(new Error('Synthetic completion telemetry offline'));
        await Promise.allSettled(receipts.map((receipt) => receipt.promise));
      });
      expect(screen.getByTestId('sandbox-ai-result')).toHaveTextContent('Routine');
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(trackedEventNames()).toEqual(['ai_checkin_started', 'ai_checkin_fallback', 'ai_checkin_completed']);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      for (const receipt of receipts) receipt.resolve();
      vi.mocked(trackProductEvent).mockResolvedValue(undefined);
    }
  });

  it.each(['en', 'es'] as const)('keeps the closing %s audio resumable after completion and stops only on close', async (locale) => {
    const play = vi.mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(new DOMException('Synthetic playback block', 'NotAllowedError'))
      .mockRejectedValueOnce(new DOMException('Synthetic second playback block', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      ...completedTurn(locale), speech: [{ kind: 'audio', mp3Base64: 'c3ludGhldGlj' }],
    }) }));
    const onComplete = vi.fn();
    const onClose = vi.fn();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={onClose} />);
    if (locale === 'es') fireEvent.click(screen.getByTestId('checkin-locale-es'));
    fireEvent.click(screen.getByTestId('checkin-voice-toggle'));
    sendAnswer();
    await screen.findByTestId('sandbox-ai-result');
    const resume = await screen.findByRole('button', { name: 'Play assistant audio' });
    fireEvent.click(resume);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Play assistant audio' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Play assistant audio' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Play assistant audio' })).not.toBeInTheDocument());
    expect(play).toHaveBeenCalledTimes(3);
    const pauses = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Close check-in' }));
    expect(vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length).toBeGreaterThan(pauses);
    expect(screen.getByTestId('sandbox-ai-result')).toHaveTextContent('Routine');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trackedEventNames().filter((name) => name === 'ai_checkin_completed')).toHaveLength(1);
  });
});
