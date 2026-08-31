import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SandboxDailyLoop } from '@/app/(sandbox)/sandbox/_components/sandbox-daily-loop';
import { ExplainRuleButton } from '@/app/(sandbox)/sandbox/_components/explain-rule';
import { ProtocolAssistant } from '@/app/(public)/guide/_components/protocol-assistant';
import type { OutreachWorkItem } from '@/lib/sandbox-ai/fixtures';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const WORK_ITEMS: OutreachWorkItem[] = [
  { id: 'w1', patientName: 'Maria Santos (synthetic)', disposition: 'escalated', redFlagMessages: ['Weight gain of 5+ lbs in 1 week detected'], atLabel: '07:15' },
  { id: 'w2', patientName: 'James Tallchief (synthetic)', disposition: 'routine', redFlagMessages: [], atLabel: '07:30' },
];

function stubAssist(response: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => response,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('morning brief (Daily Loop)', () => {
  function renderLoop() {
    render(<SandboxDailyLoop
      taskStates={{}}
      onTaskState={vi.fn()}
      onOpenPatient={vi.fn()}
      onBulkReview={vi.fn()}
      outreachItems={WORK_ITEMS}
      onOpenOutreach={vi.fn()}
    />);
  }

  it('drafts itself on open and renders with the registered-rules label', async () => {
    stubAssist({ kind: 'morning_brief', brief: 'Maria Santos needs the first callback; James stays routine.' });
    renderLoop();

    // No click needed: the repetitive read-through drafts automatically.
    const brief = await screen.findByTestId('morning-brief');
    expect(brief).toHaveTextContent('Maria Santos needs the first callback');
    expect(brief).toHaveTextContent('never by the AI');
    expect(screen.getByTestId('draft-morning-brief')).toHaveTextContent('Refresh morning brief');
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.kind).toBe('morning_brief');
    expect(body.input.items).toHaveLength(2);
  });

  it('fails silently on the automatic draft but explains a manual refresh failure', async () => {
    stubAssist({ fallback: true });
    renderLoop();

    // Auto-draft fallback stays quiet; the deterministic list is untouched.
    await vi.waitFor(() => expect(screen.getByTestId('draft-morning-brief')).toHaveTextContent('Draft morning brief'));
    expect(screen.queryByTestId('morning-brief-unavailable')).toBeNull();
    expect(screen.getByTestId('daily-loop-outreach')).toHaveTextContent('Maria Santos (synthetic)');

    fireEvent.click(screen.getByTestId('draft-morning-brief'));
    expect(await screen.findByTestId('morning-brief-unavailable')).toBeInTheDocument();
  });
});

describe('ExplainRuleButton', () => {
  it('fetches and shows the explanation with its non-decisional label', async () => {
    stubAssist({ kind: 'explain_rule', explanation: 'Her weight rose faster than the five-pound weekly limit this rule watches.' });
    render(<ExplainRuleButton ruleId="weight_gain_5lb_7d" extraction={{ weightLbs: 179.5 }} />);
    fireEvent.click(screen.getByTestId('explain-rule-button-weight_gain_5lb_7d'));

    const explanation = await screen.findByTestId('explain-rule-weight_gain_5lb_7d');
    expect(explanation).toHaveTextContent('five-pound weekly limit');
    expect(explanation).toHaveTextContent('the rule itself made the decision');
  });

  it('renders nothing for rules outside the registered explainable set', () => {
    render(<ExplainRuleButton ruleId="titration_gate_hold" />);
    expect(screen.queryByTestId('explain-rule-button-titration_gate_hold')).toBeNull();
  });
});

describe('ProtocolAssistant (guide)', () => {
  beforeEach(() => {
    stubAssist({ kind: 'protocol_qa', answer: 'The Generic Bridge keeps therapy affordable with generics.', citations: ['Module 2 §2.4'] });
  });

  it('asks a suggested question and renders the cited answer', async () => {
    render(<ProtocolAssistant />);
    fireEvent.click(screen.getByRole('button', { name: 'How does the Generic Bridge keep therapy affordable?' }));

    const answer = await screen.findByTestId('protocol-assistant-answer');
    expect(answer).toHaveTextContent('Generic Bridge');
    expect(within(answer).getByText('Module 2 §2.4')).toBeInTheDocument();
    expect(screen.getByTestId('protocol-assistant')).toHaveTextContent(/not medical advice/i);
  });

  it('degrades to the unavailable notice on fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ fallback: true }) }));
    render(<ProtocolAssistant />);
    fireEvent.submit(screen.getByLabelText('Ask about the implementation content').closest('form')!);
    // Too-short questions never fire a request.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Ask about the implementation content'), { target: { value: 'What about titration?' } });
    fireEvent.submit(screen.getByLabelText('Ask about the implementation content').closest('form')!);
    expect(await screen.findByTestId('protocol-assistant-unavailable')).toBeInTheDocument();
  });
});
