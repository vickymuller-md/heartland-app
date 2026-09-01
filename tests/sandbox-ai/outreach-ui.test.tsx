import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function openMariaSbar() {
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);
    const maria = screen.getByTestId('outreach-call-call-maria-redflag');
    fireEvent.click(within(maria).getByRole('button', { name: /Draft SBAR handoff/ }));
    return screen.getByTestId('sandbox-sbar-draft');
  }

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

  it('offers pre-generated synthetic audio on scripted calls, labeled as simulation', () => {
    render(<SandboxOutreach liveCalls={[LIVE_TRANSCRIPT]} runs={[]} onLiveCall={onLiveCall} />);

    const audioBlock = screen.getByTestId('outreach-audio-call-maria-redflag');
    expect(within(audioBlock).getByLabelText(/Synthetic audio simulation of the call with Maria Santos/)).toBeInTheDocument();
    expect(audioBlock.textContent).toContain('no real call is placed');
    // Live simulations are text-only: no audio block is rendered for them.
    expect(screen.queryByTestId(`outreach-audio-${LIVE_TRANSCRIPT.id}`)).toBeNull();
  });

  it('expands a transcript to show the turns and the structured extraction', () => {
    render(<SandboxOutreach liveCalls={[]} runs={[]} onLiveCall={onLiveCall} />);
    const maria = screen.getByTestId('outreach-call-call-maria-redflag');

    fireEvent.click(within(maria).getByRole('button', { name: /View transcript/ }));
    expect(within(maria).getByText(/creeping up this week/)).toBeInTheDocument();
    expect(within(maria).getByText('Structured data captured by the AI layer')).toBeInTheDocument();
  });

  it('drafts an SBAR handoff with S/B populated and A/R left to the provider', () => {
    const draft = openMariaSbar();
    expect((within(draft).getByLabelText('Situation') as HTMLTextAreaElement).value).toContain('Maria Santos');
    expect((within(draft).getByLabelText('Recommendation') as HTMLTextAreaElement).value).toContain('Provider to complete');
  });

  it('proposes AI wording only for S/B and preserves provider A/R through accept and undo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        kind: 'sbar_polish',
        situation: 'Proposed situation wording.',
        background: 'Proposed background wording.',
        assessment: 'AI assessment must never appear.',
        recommendation: 'AI recommendation must never appear.',
      }),
    }));
    const draft = openMariaSbar();
    const situation = within(draft).getByLabelText('Situation') as HTMLTextAreaElement;
    const background = within(draft).getByLabelText('Background') as HTMLTextAreaElement;
    const assessment = within(draft).getByLabelText('Assessment') as HTMLTextAreaElement;
    const recommendation = within(draft).getByLabelText('Recommendation') as HTMLTextAreaElement;
    const originalSituation = situation.value;
    const originalBackground = background.value;

    fireEvent.change(assessment, { target: { value: 'Provider-owned assessment.' } });
    fireEvent.change(recommendation, { target: { value: 'Provider-owned recommendation.' } });
    fireEvent.click(within(draft).getByTestId('sbar-polish'));

    const proposal = await within(draft).findByTestId('sbar-polish-proposal');
    const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(requestBody.input.sbar.assessment).toBe('Provider-owned field excluded from AI wording request.');
    expect(requestBody.input.sbar.recommendation).toBe('Provider-owned field excluded from AI wording request.');
    expect(requestBody.input.sbar.assessment).not.toContain('Provider-owned assessment.');
    expect(requestBody.input.sbar.recommendation).not.toContain('Provider-owned recommendation.');
    expect(situation).toHaveValue(originalSituation);
    expect(background).toHaveValue(originalBackground);
    expect(assessment).toHaveValue('Provider-owned assessment.');
    expect(recommendation).toHaveValue('Provider-owned recommendation.');
    expect(proposal).toHaveTextContent('Proposed situation wording.');
    expect(proposal).toHaveTextContent('Proposed background wording.');
    expect(proposal).not.toHaveTextContent('AI assessment must never appear.');
    expect(proposal).not.toHaveTextContent('AI recommendation must never appear.');

    fireEvent.click(within(proposal).getByRole('button', { name: 'Accept proposal' }));
    expect(situation).toHaveValue('Proposed situation wording.');
    expect(background).toHaveValue('Proposed background wording.');
    expect(assessment).toHaveValue('Provider-owned assessment.');
    expect(recommendation).toHaveValue('Provider-owned recommendation.');
    expect(within(draft).getByTestId('sbar-polish-accepted')).toHaveTextContent('Assessment and Recommendation stayed unchanged');

    fireEvent.click(within(draft).getByRole('button', { name: 'Undo accepted wording' }));
    expect(situation).toHaveValue(originalSituation);
    expect(background).toHaveValue(originalBackground);
    expect(assessment).toHaveValue('Provider-owned assessment.');
    expect(recommendation).toHaveValue('Provider-owned recommendation.');
  });

  it('rejects an AI wording proposal without changing the SBAR draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        kind: 'sbar_polish',
        situation: 'Rejected situation wording.',
        background: 'Rejected background wording.',
        assessment: 'Rejected AI assessment.',
        recommendation: 'Rejected AI recommendation.',
      }),
    }));
    const draft = openMariaSbar();
    const situation = within(draft).getByLabelText('Situation') as HTMLTextAreaElement;
    const background = within(draft).getByLabelText('Background') as HTMLTextAreaElement;
    const originalSituation = situation.value;
    const originalBackground = background.value;

    fireEvent.click(within(draft).getByTestId('sbar-polish'));
    const proposal = await within(draft).findByTestId('sbar-polish-proposal');
    fireEvent.click(within(proposal).getByRole('button', { name: 'Reject proposal' }));

    expect(situation).toHaveValue(originalSituation);
    expect(background).toHaveValue(originalBackground);
    expect(within(draft).queryByTestId('sbar-polish-proposal')).not.toBeInTheDocument();
    expect(within(draft).getByTestId('sbar-polish-rejected')).toHaveTextContent('draft is unchanged');
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
