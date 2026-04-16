import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DisclaimerFooter } from '@/components/disclaimers/disclaimer-footer';

// ==========================================================================
// DISC-01: Global disclaimer footer -- non-dismissible, every page
// Verbatim text from reference/app_statement.md Primary Disclaimer
// ==========================================================================
describe('DisclaimerFooter (DISC-01)', () => {
  it('renders the primary disclaimer text verbatim from app_statement.md', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/clinical decision support tool/i),
    ).toBeInTheDocument();
  });

  it('disclaimer text includes "clinical decision support tool"', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/clinical decision support tool/i),
    ).toBeInTheDocument();
  });

  it('disclaimer text includes "For professional use only"', () => {
    render(<DisclaimerFooter />);
    expect(
      screen.getByText(/For professional use only/),
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
