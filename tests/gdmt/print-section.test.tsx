import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintSection } from '@/app/(public)/gdmt-pathway/print-section';
import { FINERENONE_MONITORING, GENERIC_BRIDGE_PRICE_NOTE, SAFETY_GATE_SCOPE } from '@/lib/gdmt/constants';
import { FINERENONE_POTASSIUM_BANDS, FINERENONE_RESTART_RULE } from '@/lib/titration/constants';

describe('Printed GDMT reference parity', () => {
  it('retains every finerenone band, restart footnote and both laboratory milestones', () => {
    render(<PrintSection />);
    for (const band of FINERENONE_POTASSIUM_BANDS) {
      expect(screen.getByText(band.instruction)).toBeInTheDocument();
    }
    expect(screen.getByText(FINERENONE_RESTART_RULE)).toBeInTheDocument();
    expect(screen.getByText(FINERENONE_MONITORING.labelMinimum)).toBeInTheDocument();
    expect(screen.getByText(FINERENONE_MONITORING.protocolAddition)).toBeInTheDocument();
  });

  it('prints drug-specific initiation and interaction qualifications', () => {
    render(<PrintSection />);
    expect(screen.getByText(/exactly 5.0 is permitted/)).toBeInTheDocument();
    expect(screen.getByText('Concomitant strong CYP3A inhibitors (INSPRA label 4)')).toBeInTheDocument();
    expect(screen.getByText(SAFETY_GATE_SCOPE)).toBeInTheDocument();
  });

  it('prints individualized sodium, dated prices and the unpublished candidate boundary', () => {
    const { container } = render(<PrintSection />);
    expect(screen.getByText(/not a universal prescription/)).toBeInTheDocument();
    expect(screen.getByText(GENERIC_BRIDGE_PRICE_NOTE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('~$15');
    expect(container.textContent).not.toContain('$500/month');
    expect(screen.getByText(/not a published or clinically approved release/)).toBeInTheDocument();
  });
});
