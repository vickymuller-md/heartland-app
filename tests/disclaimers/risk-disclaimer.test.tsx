import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskScoreDisclaimer } from '@/components/disclaimers/risk-score-disclaimer';

// ==========================================================================
// DISC-02: Risk Score Disclaimer -- Alert component with AlertTriangle
// Verbatim text from reference/app_statement.md Risk Score Disclaimer
// ==========================================================================
describe('RiskScoreDisclaimer (DISC-02)', () => {
  it('renders risk score disclaimer with warning styling', () => {
    render(<RiskScoreDisclaimer />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('disclaimer text includes "pragmatic heuristic"', () => {
    render(<RiskScoreDisclaimer />);
    expect(
      screen.getByText(/pragmatic heuristic/i),
    ).toBeInTheDocument();
  });

  it('disclaimer text includes "not been statistically validated"', () => {
    render(<RiskScoreDisclaimer />);
    expect(
      screen.getByText(/not been statistically validated/i),
    ).toBeInTheDocument();
  });

  it('renders AlertTriangle icon', () => {
    const { container } = render(<RiskScoreDisclaimer />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
