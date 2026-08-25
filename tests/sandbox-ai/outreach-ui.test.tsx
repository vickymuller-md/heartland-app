import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OUTREACH_TRANSCRIPTS, type SimulatedCallTranscript } from '@/lib/sandbox-ai/fixtures';
import { SandboxOutreach } from '@/app/(sandbox)/sandbox/_components/sandbox-outreach';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { emptyExtraction } from '@/lib/sandbox-ai/engine';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const LIVE_TRANSCRIPT: SimulatedCallTranscript = {
  id: 'ai-run-test1234',
  patientId: null,
  patientName: 'Earl Hutchins (synthetic)',
  channel: 'automated-voice-simulation',
  placedLabel: 'This visit · just now',
  turns: [
    { speaker: 'assistant', text: 'Good morning, this is your automated check-in.' },
    { speaker: 'patient', text: 'Morning. Scale said 214 today.' },
  ],
  extraction: { ...emptyExtraction(), weightLbs: 214 },
  redFlags: [{ id: 'weight_gain_3lb_2d', severity: 'warning', message: 'Weight gain of 3+ lbs in 2 days detected', action: 'Call your clinic today' }],
  disposition: 'escalated',
};

describe('SandboxOutreach', () => {
  const onLiveCall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the fixture calls with rule-derived dispositions and red-flag rules', () => {
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);

    for (const transcript of OUTREACH_TRANSCRIPTS) {
      expect(screen.getByTestId(`outreach-call-${transcript.id}`)).toBeInTheDocument();
    }
    const maria = screen.getByTestId('outreach-call-call-maria-redflag');
    expect(within(maria).getByText('Escalated to human review')).toBeInTheDocument();
    expect(within(maria).getByText(/Rule: weight_gain_5lb_7d/)).toBeInTheDocument();
    const robert = screen.getByTestId('outreach-call-call-robert-noanswer');
    expect(within(robert).getByText('No answer · human follow-up')).toBeInTheDocument();
  });

  it('expands a transcript to show the turns and the structured extraction', () => {
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);
    const maria = screen.getByTestId('outreach-call-call-maria-redflag');

    fireEvent.click(within(maria).getByRole('button', { name: /View transcript/ }));
    expect(within(maria).getByText(/It said 179 and a half/)).toBeInTheDocument();
    expect(within(maria).getByText('Structured data captured by the AI layer')).toBeInTheDocument();
  });

  it('drafts an SBAR handoff with S/B populated and A/R left to the provider', () => {
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);
    const maria = screen.getByTestId('outreach-call-call-maria-redflag');

    fireEvent.click(within(maria).getByRole('button', { name: /Draft SBAR handoff/ }));
    const draft = screen.getByTestId('sandbox-sbar-draft');
    expect((within(draft).getByLabelText('Situation') as HTMLTextAreaElement).value).toContain('Maria Santos');
    expect((within(draft).getByLabelText('Recommendation') as HTMLTextAreaElement).value).toContain('Provider to complete');
  });

  it('records a successful live simulation through the callback and telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transcript: LIVE_TRANSCRIPT }),
    }));
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);

    fireEvent.click(screen.getByTestId('run-simulated-call'));
    await waitFor(() => expect(onLiveCall).toHaveBeenCalledWith(LIVE_TRANSCRIPT));
    const events = vi.mocked(trackProductEvent).mock.calls.map(([input]) => input.eventName);
    expect(events).toEqual(expect.arrayContaining(['ai_call_sim_run', 'ai_escalation_demonstrated']));
  });

  it('shows the unavailable notice when the endpoint answers fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    }));
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);

    fireEvent.click(screen.getByTestId('run-simulated-call'));
    expect(await screen.findByTestId('simulate-unavailable')).toBeInTheDocument();
    expect(onLiveCall).not.toHaveBeenCalled();
  });
});
