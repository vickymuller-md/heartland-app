import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { FILLER_LINES } from '@/lib/sandbox-ai/script';
import { SandboxLiveCall } from '@/app/(sandbox)/sandbox/_components/sandbox-live-call';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { callPromptsFor, fillerPromptsFor } from '@/lib/sandbox-ai/call-prompts';
import { applyDeterministicAnswer, createInitialState } from '@/lib/sandbox-ai/engine';
import type { CheckInTurnResponse } from '@/lib/sandbox-ai/types';
import { useAssistantAudioQueue } from '@/app/(sandbox)/sandbox/_components/use-assistant-audio-queue';

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
  for (let i = 0; i < 10; i += 1) finishAudio(audioElement());
}

/** Model a genuine media completion; a subsequent source has ended=false. */
function finishAudio(audio: HTMLElement) {
  Object.defineProperty(audio, 'ended', { configurable: true, value: true });
  fireEvent.ended(audio);
  Object.defineProperty(audio, 'ended', { configurable: true, value: false });
}

function enableMicrophone() {
  fireEvent.click(screen.getByTestId('live-call-mic-opt-in'));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function typeAnswer(message = 'synthetic answer') {
  const input = screen.getByLabelText('Say something in your own words');
  fireEvent.change(input, { target: { value: message } });
  fireEvent.submit(input.closest('form')!);
}

function emergencyTurn(): CheckInTurnResponse {
  return applyDeterministicAnswer(createInitialState(maria.id), { chestPainOrSyncope: true });
}

function jsonTurn(turn: CheckInTurnResponse) {
  return new Response(JSON.stringify(turn), { headers: { 'Content-Type': 'application/json' } });
}

/** The controlled transport can settle after cancellation, exercising stale-result guards too. */
function pendingSpeechResponse(turn: CheckInTurnResponse) {
  const encoder = new TextEncoder();
  const pending = deferred<ReadableStreamReadResult<Uint8Array>>();
  const reader = {
    read: vi.fn()
      .mockResolvedValueOnce({ done: false, value: encoder.encode(`${JSON.stringify(turn)}\n`) })
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ done: true, value: undefined }),
    cancel: vi.fn().mockResolvedValue(undefined),
    releaseLock: vi.fn(),
  };
  return {
    response: { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/x-ndjson' }), body: { getReader: () => reader } },
    reader,
    finish: () => pending.resolve({ done: false, value: encoder.encode(`${JSON.stringify({ speech: [{ kind: 'audio', mp3Base64: 'TEFURQ==' }] })}\n`) }),
  };
}

/** Real shared hook, with controls only for deterministic media lifecycle assertions. */
function AudioQueueHarness() {
  const { audioRef, speaking, enqueue, stop, needsTap, resumeAfterTap } = useAssistantAudioQueue();
  return <>
    <audio ref={audioRef} data-testid="queue-audio" />
    <output data-testid="queue-state">{speaking ? 'speaking' : 'idle'}</output>
    <button onClick={() => { enqueue('/one.mp3'); enqueue('/two.mp3'); enqueue('/three.mp3'); }}>Queue three</button>
    <button onClick={() => enqueue('/new.mp3')}>Queue new</button>
    <button onClick={stop}>Stop queue</button>
    {needsTap && <button onClick={resumeAfterTap}>Resume queue</button>}
  </>;
}

describe('SandboxLiveCall — conversation integrity regressions', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('handles rejected best-effort metrics without changing offline fallback or duplicating completion', async () => {
    const metrics = Array.from({ length: 4 }, () => deferred<void>());
    const catches = metrics.map((metric) => vi.spyOn(metric.promise, 'catch'));
    const errorLog = vi.spyOn(console, 'error');
    let metricIndex = 0;
    vi.mocked(trackProductEvent).mockImplementation(() => metrics[metricIndex++].promise);
    vi.mocked(fetch).mockRejectedValue(new TypeError('Synthetic offline transport'));
    try {
      render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
      fireEvent.click(screen.getByTestId('answer-call'));
      // Assert the real helper attached a rejection handler before rejecting.
      // On the old implementation RED remains safe: finally resolves all promises.
      expect(catches[0]).toHaveBeenCalledTimes(1);
      await act(async () => { metrics[0].reject(new Error('Synthetic unavailable metrics')); });
      await act(async () => { typeAnswer(); });
      expect(screen.getByRole('log')).toHaveTextContent('please use the quick answers below');
      expect(catches[1]).toHaveBeenCalledTimes(1);
      await act(async () => { metrics[1].reject(new Error('Synthetic unavailable metrics')); });
      chip('Yes — chest pain or fainting');
      expect(catches[2]).toHaveBeenCalledTimes(1);
      expect(catches[3]).toHaveBeenCalledTimes(1);
      await act(async () => {
        metrics[2].reject(new Error('Synthetic unavailable metrics'));
        metrics[3].reject(new Error('Synthetic unavailable metrics'));
      });
      drainAudioQueue();
      expect(screen.getByTestId('live-call-result')).toHaveTextContent('Emergency pathway demonstrated');
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(vi.mocked(trackProductEvent).mock.calls.map(([event]) => event.eventName)).toEqual([
        'ai_checkin_started', 'ai_checkin_fallback', 'ai_checkin_completed', 'ai_escalation_demonstrated',
      ]);
      fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      for (const metric of metrics) metric.resolve(undefined);
      vi.mocked(trackProductEvent).mockResolvedValue(undefined);
    }
  });

  it.each(['en', 'es'] as const)('enqueues the selected %s filler from its own audio catalog', (locale) => {
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId(`call-locale-${locale}`));
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();
    typeAnswer();
    const filler = fillerPromptsFor(locale)[0];
    expect(screen.getByRole('log')).toHaveTextContent(filler.text);
    expect(audioElement().getAttribute('src')).toBe(filler.audioSrc);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('keeps manual playback available after two autoplay blocks, without automatic retries', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    await act(async () => {});
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play assistant audio' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play assistant audio' })).toBeEnabled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Play assistant audio' }));
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Play assistant audio' })).not.toBeInTheDocument();
    finishAudio(audioElement());
    expect(audioElement().getAttribute('src')).toBe(callPromptsFor('daily_checkin', 'en').q1_safety.audioSrc);
  });

  it('retains closing audio and its manual CTA after completion, with one outcome callback', async () => {
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    chip('Yes — chest pain or fainting');
    await act(async () => {});
    expect(screen.getByTestId('live-call-result')).toHaveTextContent('Emergency pathway demonstrated');
    expect(audioElement().getAttribute('src')).toBe(callPromptsFor('daily_checkin', 'en').emergency.audioSrc);
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play assistant audio' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Play assistant audio' })).toBeEnabled();
    vi.mocked(HTMLMediaElement.prototype.play).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Play assistant audio' }));
    await act(async () => {});
    finishAudio(audioElement());
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)('closing before a late %s response cancels the request without completion or fallback', async (outcome) => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => pending.promise);
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    typeAnswer();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await act(async () => {
      if (outcome === 'success') pending.resolve(jsonTurn(emergencyTurn()));
      else pending.reject(new Error('late synthetic transport failure'));
    });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('live-call-result')).not.toBeInTheDocument();
    expect(screen.queryByText(/please use the quick answers below/)).not.toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
    expect(vi.mocked(trackProductEvent).mock.calls.map(([event]) => event.eventName)).toEqual(['ai_checkin_started']);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it('ignores an old request after unmount and a new StrictMode call completes independently', async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const oldComplete = vi.fn();
    const view = render(<StrictMode><SandboxLiveCall patient={maria} onComplete={oldComplete} onClose={onClose} /></StrictMode>);
    fireEvent.click(screen.getByTestId('answer-call'));
    typeAnswer();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.unmount();
    render(<StrictMode><SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} /></StrictMode>);
    fireEvent.click(screen.getByTestId('answer-call'));
    await act(async () => { pending.resolve(jsonTurn(emergencyTurn())); });
    expect(oldComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('live-call-result')).not.toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    drainAudioQueue();
    chip('Yes — chest pain or fainting');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('live-call-result')).toHaveTextContent('Emergency pathway demonstrated');
  });

  it.each([false, true])('closing between NDJSON phases cancels the reader and timer (already completed: %s)', async (done) => {
    vi.useFakeTimers();
    const turn = done ? emergencyTurn() : applyDeterministicAnswer(createInitialState(maria.id), { chestPainOrSyncope: false });
    turn.assistantMessages = ['Synthetic acknowledgment pending audio.', ...turn.assistantMessages];
    turn.speech = [{ kind: 'pending' }, null];
    const stream = pendingSpeechResponse(turn);
    vi.mocked(fetch).mockResolvedValue(stream.response as Response);
    const view = render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    typeAnswer();
    await act(async () => {});
    expect(screen.getByRole('log')).toHaveTextContent('Synthetic acknowledgment pending audio.');
    expect(onComplete).toHaveBeenCalledTimes(done ? 1 : 0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await act(async () => { stream.finish(); });
    fireEvent.ended(audioElement());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
    expect(onComplete).toHaveBeenCalledTimes(done ? 1 : 0);
    expect(stream.reader.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the audio-phase timeout after successful resolution while preserving the active call timer', async () => {
    vi.useFakeTimers();
    const turn = applyDeterministicAnswer(createInitialState(maria.id), { chestPainOrSyncope: false });
    turn.speech = [{ kind: 'pending' }];
    const stream = pendingSpeechResponse(turn);
    vi.mocked(fetch).mockResolvedValue(stream.response as Response);
    const view = render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    typeAnswer();
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(2);
    await act(async () => { stream.finish(); });
    expect(vi.getTimerCount()).toBe(1);
    expect(within(screen.getByTestId('live-call-numbers')).getByRole('button', { name: 'Send' })).toBeEnabled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounting while the first NDJSON line is pending cancels its reader and ignores a late complete turn', async () => {
    const pending = deferred<ReadableStreamReadResult<Uint8Array>>();
    const reader = {
      read: vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/x-ndjson' }), body: { getReader: () => reader },
    } as unknown as Response);
    const view = render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    typeAnswer();
    await act(async () => {});
    expect(reader.read).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => {
      pending.resolve({ done: false, value: new TextEncoder().encode(`${JSON.stringify(emergencyTurn())}\n`) });
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(vi.mocked(trackProductEvent).mock.calls.map(([event]) => event.eventName)).toEqual(['ai_checkin_started']);
  });

  it('a completed streamed turn keeps acknowledgment then closing audio, without repeating its callback', async () => {
    const turn = emergencyTurn();
    turn.assistantMessages = ['Synthetic acknowledgment pending audio.', ...turn.assistantMessages];
    turn.speech = [{ kind: 'pending' }, null];
    const stream = pendingSpeechResponse(turn);
    vi.mocked(fetch).mockResolvedValue(stream.response as Response);
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();
    typeAnswer();
    await act(async () => {});
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('live-call-result')).toHaveTextContent('Emergency pathway demonstrated');
    expect(audioElement().getAttribute('src')).toBe(fillerPromptsFor('en')[0].audioSrc);
    await act(async () => { stream.finish(); });
    finishAudio(audioElement());
    expect(audioElement().getAttribute('src')).toBe('data:audio/mpeg;base64,TEFURQ==');
    finishAudio(audioElement());
    expect(audioElement().getAttribute('src')).toBe(callPromptsFor('daily_checkin', 'en').emergency.audioSrc);
    finishAudio(audioElement());
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(trackProductEvent).mock.calls.filter(([event]) => event.eventName === 'ai_checkin_completed')).toHaveLength(1);
  });

  it('closing during media releases playback and the opted-in microphone without late recognition callbacks', async () => {
    FakeSpeechRecognition.instances = [];
    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);
    vi.useFakeTimers();
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    enableMicrophone();
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();
    const recognition = latestRecognition();
    expect(recognition.started).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    await act(async () => { recognition.emitFinal('late synthetic answer'); });
    fireEvent.ended(audioElement());
    expect(recognition.started).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(audioElement().getAttribute('src')).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCount);
    expect(vi.getTimerCount()).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('closing during queued playback prevents a late ended event from starting the next clip', () => {
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'End simulated call' }));
    fireEvent.ended(audioElement());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(audioElement().getAttribute('src')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('useAssistantAudioQueue — real shared hook lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('a NotSupported rejection advances text-only without waiting for a missing error event', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('unsupported', 'NotSupportedError'));
    render(<AudioQueueHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    await act(async () => {});
    expect(screen.getByTestId('queue-audio')).toHaveAttribute('src', '/two.mp3');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Resume queue' })).not.toBeInTheDocument();
  });

  it('deduplicates the same source failure when an error event precedes the play rejection', async () => {
    const firstPlay = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => firstPlay.promise);
    render(<AudioQueueHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    const audio = screen.getByTestId('queue-audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'error', { configurable: true, get: () => ({ code: 4 }) });
    fireEvent.error(audio);
    // Browsers reset media.error when a new source is selected.
    Object.defineProperty(audio, 'error', { configurable: true, get: () => null });
    expect(audio).toHaveAttribute('src', '/two.mp3');
    await act(async () => { firstPlay.reject(new DOMException('unsupported', 'NotSupportedError')); });
    expect(audio).toHaveAttribute('src', '/two.mp3');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    finishAudio(audio);
    expect(audio).toHaveAttribute('src', '/three.mp3');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
  });

  it('ignores a late autoplay rejection from a finished clip while the next clip plays', async () => {
    const firstPlay = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => firstPlay.promise);
    render(<AudioQueueHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    const audio = screen.getByTestId('queue-audio');
    finishAudio(audio);
    await act(async () => { firstPlay.reject(new DOMException('old block', 'NotAllowedError')); });
    expect(audio).toHaveAttribute('src', '/two.mp3');
    expect(screen.queryByRole('button', { name: 'Resume queue' })).not.toBeInTheDocument();
    expect(screen.getByTestId('queue-state')).toHaveTextContent('speaking');
  });

  it('ignores stale DOM ended/error events once the current source is playing normally', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException('unsupported', 'NotSupportedError'));
    render(<AudioQueueHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    await act(async () => {});
    const audio = screen.getByTestId('queue-audio') as HTMLAudioElement;
    expect(audio).toHaveAttribute('src', '/two.mp3');
    Object.defineProperty(audio, 'error', { configurable: true, get: () => null });
    expect(audio.ended).toBe(false);
    expect(audio.error).toBeNull();
    fireEvent.error(audio);
    fireEvent.ended(audio);
    expect(audio).toHaveAttribute('src', '/two.mp3');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    finishAudio(audio);
    expect(audio).toHaveAttribute('src', '/three.mp3');
  });

  it('stop invalidates pending playback, empties the queue, and permits an independent new cycle', async () => {
    const firstPlay = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => firstPlay.promise);
    render(<AudioQueueHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop queue' }));
    const audio = screen.getByTestId('queue-audio');
    expect(audio.getAttribute('src')).toBeNull();
    expect(screen.getByTestId('queue-state')).toHaveTextContent('idle');
    fireEvent.click(screen.getByRole('button', { name: 'Queue new' }));
    await act(async () => { firstPlay.reject(new DOMException('old block', 'NotAllowedError')); });
    expect(audio).toHaveAttribute('src', '/new.mp3');
    expect(screen.queryByRole('button', { name: 'Resume queue' })).not.toBeInTheDocument();
    finishAudio(audio);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('queue-state')).toHaveTextContent('idle');
  });

  it('StrictMode cleanup stops media without disabling the remounted queue', () => {
    const view = render(<StrictMode><AudioQueueHarness /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Queue three' }));
    const oldAudio = screen.getByTestId('queue-audio');
    expect(oldAudio).toHaveAttribute('src', '/one.mp3');
    view.unmount();
    expect(oldAudio.getAttribute('src')).toBeNull();
    const plays = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
    fireEvent.ended(oldAudio);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(plays);
    render(<StrictMode><AudioQueueHarness /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: 'Queue new' }));
    expect(screen.getByTestId('queue-audio')).toHaveAttribute('src', '/new.mp3');
    finishAudio(screen.getByTestId('queue-audio'));
    expect(screen.getByTestId('queue-state')).toHaveTextContent('idle');
  });
});

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

  it('keeps the microphone off until the visitor opts in after seeing the processing disclosure', () => {
    expect(screen.getByTestId('live-call-mic-opt-in')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/browser speech service transcribes audio/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('answer-call'));
    drainAudioQueue();

    expect(FakeSpeechRecognition.instances).toHaveLength(0);
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Microphone off');
  });

  it('opens the mic only after explicit opt-in and after the assistant finishes speaking, then voices the server turn', async () => {
    enableMicrophone();
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
    // The filler has its own clip; the dynamic payload follows it in order.
    expect(fillerPromptsFor('en').map((filler) => filler.audioSrc)).toContain(audioElement().getAttribute('src'));
    finishAudio(audioElement());
    expect(audioElement().src).toContain('data:audio/mpeg;base64,QUJD');
    const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(requestBody.wantSpeech).toBe(true);

    // Assistant audio finished → the mic reopens by itself.
    drainAudioQueue();
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
    expect(FakeSpeechRecognition.instances.length).toBeGreaterThan(1);
  });

  it('keeps hands-free listening alive when a clip source is missing (no needsTap trap)', async () => {
    // Missing/undecodable sources reject play() with NotSupportedError — the
    // queue must advance text-only instead of waiting for a pointless tap.
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
      Object.assign(new Error('no supported source'), { name: 'NotSupportedError' }),
    );
    enableMicrophone();
    fireEvent.click(screen.getByTestId('answer-call'));
    await act(async () => { /* flush play() rejections */ });

    expect(screen.queryByText('Play assistant audio')).toBeNull();
    drainAudioQueue();
    expect(screen.getByTestId('live-call-voice-status')).toHaveTextContent('Listening — just talk');
  });

  it('mute stops listening and the status explains typed and tapped answers still work', () => {
    enableMicrophone();
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
    enableMicrophone();
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

describe('SandboxLiveCall — locales and scripts (deterministic paths)', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('speaks Spanish end to end when Español is chosen before answering', () => {
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('call-locale-es'));
    fireEvent.click(screen.getByTestId('answer-call'));

    expect(screen.getByRole('log').textContent).toContain('dolor de pecho');
    expect(screen.getByRole('log')).toHaveAttribute('lang', 'es-US');
    chip('No, nada de eso');
    expect(screen.getByRole('log').textContent).toContain('báscula');
  });

  it('routes a titration follow-up with skipped readings to nurse review', () => {
    render(<SandboxLiveCall patient={maria} scriptId="titration_followup" onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));
    expect(screen.getByRole('log').textContent).toContain('since we increased your medicine');

    chip('No, nothing like that');
    chip('No dizziness');
    fireEvent.submit(screen.getByTestId('live-call-numbers')); // t3 skipped
    fireEvent.submit(screen.getByTestId('live-call-numbers')); // t4 skipped
    chip('No, feeling the same');
    chip('Yes, every day');

    const result = screen.getByTestId('live-call-result');
    expect(result).toHaveTextContent('Held for nurse review');
    expect(result).toHaveTextContent('systolic blood pressure, heart rate');
    expect(result).toHaveTextContent('registered titration safety gates, never by the AI');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('voices a filler acknowledgment as soon as a typed answer is sent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    }));
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));

    fireEvent.change(screen.getByLabelText('Say something in your own words'), { target: { value: 'no chest pain' } });
    fireEvent.submit(screen.getByLabelText('Say something in your own words').closest('form')!);
    await screen.findByText(/use the quick answers below/);

    expect(FILLER_LINES.en.some((line) => screen.getByRole('log').textContent?.includes(line))).toBe(true);
  });

  it('locks the next answer until the streamed audio phase for the current turn resolves', async () => {
    const encoder = new TextEncoder();
    let releaseSpeech: (() => void) | undefined;
    const firstTurn = {
      assistantMessages: ['Thanks for telling me.'],
      speech: [{ kind: 'pending' }],
      state: { patientId: 'demo-maria', scriptId: 'daily_checkin', locale: 'en', phase: 'q1_safety', extraction: {}, reasksUsed: {}, turnCount: 1 },
      done: false,
      disposition: null,
      redFlags: [],
      fallback: false,
    };
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(`${JSON.stringify(firstTurn)}\n`) })
        .mockImplementationOnce(() => new Promise((resolve) => {
          releaseSpeech = () => resolve({ done: false, value: encoder.encode(`${JSON.stringify({ speech: [null] })}\n`) });
        }))
        .mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      body: { getReader: () => reader },
    }));
    render(<SandboxLiveCall patient={maria} onComplete={onComplete} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('answer-call'));

    const input = screen.getByLabelText('Say something in your own words');
    expect(input).toHaveAttribute('aria-describedby', 'live-call-synthetic-input-note');
    fireEvent.change(input, { target: { value: 'synthetic answer' } });
    fireEvent.submit(input.closest('form')!);

    await screen.findByText('Thanks for telling me.');
    expect(input).toBeDisabled();
    expect(screen.getByText(/preparing audio/i)).toBeInTheDocument();

    await act(async () => { releaseSpeech?.(); });
    await waitFor(() => expect(input).not.toBeDisabled());
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
    const receipt = within(screen.getByTestId('live-call-decision-receipt'));
    expect(receipt.getByText('Quick answer / structured entry')).toBeInTheDocument();
    expect(receipt.getByText(/Not used — structured controls mapped directly/)).toBeInTheDocument();
    expect(receipt.getByText(/Systolic BP, SpO₂/)).toBeInTheDocument();
    expect(receipt.getByText(/weight_gain_5lb_7d · escalated/)).toBeInTheDocument();
    expect(receipt.getByText(/Provider or nurse reviews before any care action/)).toBeInTheDocument();
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
