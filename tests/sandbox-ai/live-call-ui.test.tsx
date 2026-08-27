import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { SandboxLiveCall } from '@/app/(sandbox)/sandbox/_components/sandbox-live-call';
import { trackProductEvent } from '@/lib/product-analytics/actions';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const maria = SANDBOX_PATIENTS.find((patient) => patient.id === 'demo-maria')!;

function chip(label: string | RegExp) {
  fireEvent.click(within(screen.getByTestId('live-call-chips')).getByRole('button', { name: label }));
}

function sendWeight(weight: string) {
  const form = screen.getByTestId('live-call-numbers');
  fireEvent.change(within(form).getByLabelText(/Weight/), { target: { value: weight } });
  fireEvent.submit(form);
}

// ── Voice mode (Web Speech API stub) ─────────────────────────

interface FakeResultEvent { results: { length: number; [index: number]: { 0: { transcript: string }; isFinal: boolean } } }

class FakeSpeechRecognition {
  static instances: FakeSpeechRecognition[] = [];
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: ((event: FakeResultEvent) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() { FakeSpeechRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.started = false; }
  abort() { this.started = false; }
  emitFinal(text: string) {
    this.onresult?.({ results: { length: 1, 0: { 0: { transcript: text }, isFinal: true } } });
    this.onend?.();
  }
  emitEmptyEnd() { this.started = false; this.onend?.(); }
}

function latestRecognition(): FakeSpeechRecognition {
  const instance = FakeSpeechRecognition.instances.at(-1);
  if (!instance) throw new Error('no recognition instance created');
  return instance;
}

function audioElement(): HTMLAudioElement {
  return screen.getByTestId('live-call-audio') as HTMLAudioElement;
}

/** Drain the assistant audio queue by firing `ended` until it stops advancing. */
function drainAudioQueue() {
  for (let i = 0; i < 10; i += 1) fireEvent(audioElement(), new Event('ended'));
}

describe('SandboxLiveCall — hands-free voice mode', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    FakeSpeechRecognition.instances = [];
    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens the mic only after the assistant finishes speaking, then voices the server turn', async () => {
    fireEvent.click(screen.getByTestId('answer-call'));

    // Intro + q1 clips are queued; while speaking there must be no listening.
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Assistant speaking…');
    expect(FakeSpeechRecognition.instances).toHaveLength(0);

    drainAudioQueue();
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
    const recognition = latestRecognition();
    expect(recognition.started).toBe(true);
    expect(recognition.lang).toBe('en-US');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        assistantMessages: ['What a treat to have your grandson visit.', 'What did the scale show this morning, in pounds?'],
        speech: [{ kind: 'audio', mp3Base64: 'QUJD' }, { kind: 'clip', clipId: 'q2_weight' }],
        state: { patientId: 'demo-maria', phase: 'q2_weight', extraction: {}, reasksUsed: {}, turnCount: 1 },
        done: false,
        disposition: null,
        redFlags: [],
        fallback: false,
      }),
    }));

    await act(async () => {
      recognition.emitFinal('no chest pain, my grandson visited yesterday');
    });

    const log = screen.getByRole('log');
    expect(log.textContent).toContain('no chest pain, my grandson visited yesterday');
    expect(log.textContent).toContain('What a treat to have your grandson visit.');
    expect(log.textContent).toContain('What did the scale show');
    // The dynamic line plays from the synthesized payload.
    expect(audioElement().src).toContain('data:audio/mpeg;base64,QUJD');
    const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(requestBody.wantSpeech).toBe(true);

    // Assistant audio finished → the mic reopens by itself.
    drainAudioQueue();
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
    expect(FakeSpeechRecognition.instances.length).toBeGreaterThan(1);
  });

  it('mute stops listening and the status explains typed and tapped answers still work', () => {
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();
    expect(latestRecognition().started).toBe(true);

    fireEvent.click(screen.getByTestId('live-call-mic-toggle'));
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Microphone off');
    expect(latestRecognition().started).toBe(false);

    // Chips keep working while muted.
    chip('No, nothing like that');
    expect(screen.getByRole('log').textContent).toContain('What did the scale show');
  });

  it('suspends voice input after two consecutive failures and recovers on mic tap', () => {
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();

    act(() => { latestRecognition().emitEmptyEnd(); });
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
    act(() => { latestRecognition().emitEmptyEnd(); });
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Voice input paused');

    fireEvent.click(screen.getByTestId('live-call-mic-toggle')); // off
    fireEvent.click(screen.getByTestId('live-call-mic-toggle')); // on again, failures reset
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
  });
});

describe('SandboxLiveCall — deterministic chip path (works fully offline)', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
  });

  it('answers the call and walks the whole check-in to a rules-driven escalation', () => {
    fireEvent.click(screen.getByTestId('answer-call'));
    expect(screen.getByRole('log').textContent).toContain('any chest pain');

    chip('No, nothing like that');
    sendWeight('179.5');
    chip('Short of breath with activity');
    chip('Moderate');
    chip(/extra pillows or sitting up/);
    chip('Quite low');
    chip('Yes, all taken');
    fireEvent.submit(screen.getByTestId('live-call-numbers')); // q8: skip devices

    const result = screen.getByTestId('live-call-result');
    expect(result).toHaveTextContent('Escalated to human review');
    expect(result).toHaveTextContent('Weight gain of 5+ lbs in 1 week detected');
    expect(onComplete).toHaveBeenCalledTimes(1);
    const events = vi.mocked(trackProductEvent).mock.calls.map(([input]) => input.eventName);
    expect(events).toEqual(expect.arrayContaining(['ai_checkin_started', 'ai_checkin_completed', 'ai_escalation_demonstrated']));
  });

  it('routes a chest-pain chip straight to the emergency pathway', () => {
    fireEvent.click(screen.getByTestId('answer-call'));
    chip('Yes — chest pain or fainting');

    expect(screen.getByTestId('live-call-result')).toHaveTextContent('Emergency pathway demonstrated');
    expect(screen.getByRole('log').textContent).toContain('call 911');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('keeps the whole flow usable when typed answers fall back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    }));
    fireEvent.click(screen.getByTestId('answer-call'));

    fireEvent.change(screen.getByLabelText('Say something in your own words'), { target: { value: 'no chest pain' } });
    fireEvent.submit(screen.getByLabelText('Say something in your own words').closest('form')!);
    await screen.findByText(/use the quick answers below/);

    // Typed input is gone; chips still complete the same question.
    expect(screen.queryByLabelText('Say something in your own words')).toBeNull();
    chip('No, nothing like that');
    expect(screen.getByRole('log').textContent).toContain('What did the scale show');
  });
});
