import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvidenceLabelDisclaimer } from '@/components/disclaimers/evidence-label-disclaimer';

// ==========================================================================
// DISC-03: Evidence Label Disclaimer -- Dialog with 3 tiers
// Verbatim text from reference/app_statement.md Evidence Labeling Disclaimer
// ==========================================================================
describe('EvidenceLabelDisclaimer (DISC-03)', () => {
  it('renders a trigger button', () => {
    render(<EvidenceLabelDisclaimer />);
    expect(
      screen.getByText(/Evidence classification/i),
    ).toBeInTheDocument();
  });

  it('dialog opens when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<EvidenceLabelDisclaimer />);
    await user.click(screen.getByText(/Evidence classification/i));
    expect(screen.getByText('Evidence Classification')).toBeInTheDocument();
  });

  it('dialog shows Established definition in green', async () => {
    const user = userEvent.setup();
    render(<EvidenceLabelDisclaimer />);
    await user.click(screen.getByText(/Evidence classification/i));
    expect(screen.getByText('Established')).toBeInTheDocument();
    expect(
      screen.getByText(/Supported by current guideline recommendations/),
    ).toBeInTheDocument();
  });

  it('dialog shows Emerging definition in yellow', async () => {
    const user = userEvent.setup();
    render(<EvidenceLabelDisclaimer />);
    await user.click(screen.getByText(/Evidence classification/i));
    expect(screen.getByText('Emerging')).toBeInTheDocument();
    expect(
      screen.getByText(/guideline integration ongoing/),
    ).toBeInTheDocument();
  });

  it('dialog shows Pragmatic definition in gray', async () => {
    const user = userEvent.setup();
    render(<EvidenceLabelDisclaimer />);
    await user.click(screen.getByText(/Evidence classification/i));
    expect(screen.getByText('Pragmatic')).toBeInTheDocument();
    expect(
      screen.getByText(/not yet validated as a standalone tool/),
    ).toBeInTheDocument();
  });

  it('dialog mentions AHA/ACC/HFSA guidelines', async () => {
    const user = userEvent.setup();
    render(<EvidenceLabelDisclaimer />);
    await user.click(screen.getByText(/Evidence classification/i));
    expect(
      screen.getByText(/AHA\/ACC\/HFSA/),
    ).toBeInTheDocument();
  });
});
