import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisclaimerFooter } from '@/components/disclaimers/disclaimer-footer';

// ==========================================================================
// DISC-01: Global disclaimer footer -- non-dismissible, every page
// Verbatim text from reference/app_statement.md Primary Disclaimer
// ==========================================================================
describe('DisclaimerFooter (DISC-01)', () => {
  it('states the controlled-evaluation boundary', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/controlled evaluation only/i),
    ).toBeInTheDocument();
  });

  it('disclaimer blocks unsupported real-PHI use', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/Real PHI and unsupervised clinical use are not authorized/i),
    ).toBeInTheDocument();
  });

  it('disclaimer preserves independent clinical judgment', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/clinical judgment/i),
    ).toBeInTheDocument();
  });

  it('footer is visible (not dismissible, no close button)', () => {
    render(<DisclaimerFooter />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('footer has print:hidden class to avoid printing', () => {
    const { container } = render(<DisclaimerFooter />);
    const footer = container.querySelector('footer');
    expect(footer).toBeInTheDocument();
    expect(footer?.className).toContain('print:hidden');
  });
});
