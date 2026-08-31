import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SandboxCopilot } from '@/app/(sandbox)/sandbox/_components/sandbox-copilot';
import type { OutreachWorkItem } from '@/lib/sandbox-ai/fixtures';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const ITEMS: OutreachWorkItem[] = [
  { id: 'w1', patientName: 'Maria Santos (synthetic)', disposition: 'escalated', redFlagMessages: ['Weight gain of 5+ lbs in 1 week detected'], atLabel: '07:15' },
];

function transcript(id: string, name: string, disposition: 'routine' | 'escalated', flags: Array<{ id: string; message: string; action: string }>) {
  return {
    id, patientId: null, patientName: name, channel: 'automated-voice-simulation',
    placedLabel: 'This visit · just now', turns: [], extraction: {}, redFlags: flags.map((flag) => ({ ...flag, severity: 'critical' })), disposition,
  };
}

function stubEndpoints() {
  let simulateCalls = 0;
  const responses = [
    transcript('r1', 'James Tallchief (synthetic)', 'routine', []),
    transcript('r2', 'Earl Hutchins (synthetic)', 'escalated', [{ id: 'weight_gain_3lb_2d', message: 'Weight gain of 3+ lbs in 2 days detected', action: 'Call your clinic today' }]),
    transcript('r3', 'Gloria Vance (synthetic)', 'routine', []),
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/simulate-call')) {
      const body = { transcript: responses[simulateCalls] };
      simulateCalls += 1;
      return { ok: true, status: 200, json: async () => body };
    }
    if (String(url).includes('/assist')) {
      return { ok: true, status: 200, json: async () => ({ kind: 'morning_brief', brief: 'Earl Hutchins needs the first callback; the other two stayed routine.', mp3Base64: 'QUJD' }) };
    }
    return { ok: true, status: 200, json: async () => ({ answer: 'Call Maria Santos first — rule weight_gain_5lb_7d fired.', toolTrace: [{ tool: 'get_queue', summary: 'queue (1 items)' }] }) };
  }));
}

describe('SandboxCopilot', () => {
  const onRecordRun = vi.fn();
  const onNavigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    stubEndpoints();
    render(<SandboxCopilot outreachItems={ITEMS} onRecordRun={onRecordRun} onNavigate={onNavigate} />);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs the morning round, records every call, and narrates the spoken brief', async () => {
    fireEvent.click(screen.getByTestId('run-morning-round'));

    const metric = await screen.findByTestId('round-metric');
    expect(metric).toHaveTextContent('3 automated check-ins processed');
    expect(metric).toHaveTextContent('never by the AI');
    expect(onRecordRun).toHaveBeenCalledTimes(3);

    const brief = await screen.findByTestId('copilot-brief');
    expect(brief).toHaveTextContent('Earl Hutchins needs the first callback');

    const prepared = screen.getByTestId('copilot-prepared');
    expect(prepared).toHaveTextContent('Earl Hutchins (synthetic)');
    expect(prepared).toHaveTextContent('Weight gain of 3+ lbs in 2 days detected');
  });

  it('degrades the round to the unavailable notice when the endpoint falls back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fallback: true }) })));
    fireEvent.click(screen.getByTestId('run-morning-round'));
    expect(await screen.findByTestId('round-unavailable')).toBeInTheDocument();
    expect(onRecordRun).not.toHaveBeenCalled();
  });

  it('answers queue questions with the consulted-tools trace', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Who should I call first, and why?' }));

    const answer = await screen.findByTestId('copilot-answer');
    expect(answer).toHaveTextContent('Call Maria Santos first');
    expect(screen.getByTestId('copilot-trace')).toHaveTextContent('Consulted: queue (1 items)');
    const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(requestBody.snapshot.workItems).toHaveLength(1);
  });

  it('hides the chat behind the unavailable notice on fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ fallback: true }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Why was the weight-gain call escalated?' }));
    expect(await screen.findByTestId('copilot-chat-unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ask about the synthetic queue')).toBeNull();
  });
});
