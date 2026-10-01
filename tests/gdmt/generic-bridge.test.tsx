import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenericBridge } from '@/components/gdmt/generic-bridge';
import { GENERIC_BRIDGE_ITEMS, GENERIC_BRIDGE_PRINCIPLE, GENERIC_BRIDGE_PRICE_NOTE, GENERIC_BRIDGE_TOTAL } from '@/lib/gdmt/constants';

// ==========================================================================
// GDMT-08: Generic Bridge Cost Display
// September 2026 reference: dated estimates, not quotes or an access guarantee.
// ==========================================================================
describe('GDMT-08: Generic Bridge', () => {
  it('renders 4 generic drug items', () => {
    render(<GenericBridge />);
    expect(GENERIC_BRIDGE_ITEMS).toHaveLength(4);
    for (const item of GENERIC_BRIDGE_ITEMS) {
      // Metformin appears in both Drug Class and Agent columns
      const matches = screen.getAllByText(item.agent);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows historical estimates and excludes the withdrawn $4 price', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Lisinopril or Losartan')).toBeInTheDocument();
    expect(screen.getAllByText('About $5-9/month')).toHaveLength(2);
    expect(screen.queryByText('$4/month')).not.toBeInTheDocument();
  });

  it('shows carvedilol with a local availability caveat', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Carvedilol generic')).toBeInTheDocument();
    expect(screen.getByText(/not available on every discount list/)).toBeInTheDocument();
  });

  it('shows the historical spironolactone range', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Spironolactone generic')).toBeInTheDocument();
    expect(screen.getByText('About $6-13/month')).toBeInTheDocument();
  });

  it('keeps the metformin indication qualification', () => {
    render(<GenericBridge />);
    const metforminCells = screen.getAllByText('Metformin');
    expect(metforminCells.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/if diabetic\/prediabetic/)).toBeInTheDocument();
  });

  it('does not imply a current bundled price or full GDMT access', () => {
    render(<GenericBridge />);
    expect(screen.getByText(GENERIC_BRIDGE_TOTAL)).toBeInTheDocument();
    expect(screen.getByText(GENERIC_BRIDGE_PRICE_NOTE)).toBeInTheDocument();
    expect(screen.queryByText('~$15-16/month')).not.toBeInTheDocument();
    expect(screen.getByText(/does not include an SGLT2i/)).toBeInTheDocument();
  });

  it('displays key principle about generic therapy', () => {
    render(<GenericBridge />);
    expect(screen.getByText(GENERIC_BRIDGE_PRINCIPLE)).toBeInTheDocument();
  });
});
