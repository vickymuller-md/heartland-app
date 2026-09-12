import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SandboxAiEvidenceFlow } from '@/app/(sandbox)/sandbox/_components/sandbox-ai-evidence-flow';
import { OUTREACH_TRANSCRIPTS } from '@/lib/sandbox-ai/fixtures';
import { simulatePopulationDay } from '@/lib/sandbox/population';

describe('SandboxAiEvidenceFlow', () => {
  it('shows the deterministic population funnel and separates AI from registered rules', () => {
    render(<SandboxAiEvidenceFlow populationSize={2500} dayIndex={0} />);

    const expected = simulatePopulationDay(2500, 0);
    const flow = screen.getByTestId('ai-evidence-flow');
    expect(flow).toHaveTextContent('See every handoff, not a black box');
    expect(flow).toHaveTextContent('AI language layer');
    expect(flow).toHaveTextContent('Registered rules');
    expect(flow).toHaveTextContent('Human review');
    expect(flow).toHaveTextContent('2,500');
    expect(flow).toHaveTextContent(`${expected.counts.automatedPct}%`);
    expect(flow).toHaveTextContent(String(expected.counts.reviewQueue));
    expect(flow).toHaveTextContent('outside the review queue');
    expect(flow).toHaveTextContent('60 unanswered after simulated retry');
    expect(flow).toHaveTextContent('Outside the queue does not mean resolved');
    expect(flow).not.toHaveTextContent('resolved by rules');
  });

  it('renders a decision receipt from the same synthetic fixture and rule output', () => {
    render(<SandboxAiEvidenceFlow populationSize={500} dayIndex={0} />);

    const fixture = OUTREACH_TRANSCRIPTS[0];
    const receipt = screen.getByTestId('decision-receipt');
    expect(receipt).toHaveTextContent(fixture.patientName);
    expect(receipt).toHaveTextContent(String(fixture.extraction.weightLbs));
    expect(receipt).toHaveTextContent(fixture.redFlags[0].id);
    expect(receipt).toHaveTextContent(fixture.disposition);
    expect(receipt).toHaveTextContent('Human review required');
    expect(receipt).toHaveTextContent('Fixed example, not a member of the generated population');
  });

  it('updates the population scenario without presenting the fixed receipt as a generated case', () => {
    const { rerender } = render(<SandboxAiEvidenceFlow populationSize={500} dayIndex={0} />);
    const receipt = screen.getByTestId('decision-receipt').textContent;
    rerender(<SandboxAiEvidenceFlow populationSize={5000} dayIndex={4} />);
    expect(screen.getByTestId('ai-evidence-flow')).toHaveTextContent('5,000');
    expect(screen.getByTestId('decision-receipt').textContent).toBe(receipt);
  });
});
