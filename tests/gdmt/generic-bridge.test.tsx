import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenericBridge } from '@/components/gdmt/generic-bridge';
import { GENERIC_BRIDGE_ITEMS, GENERIC_BRIDGE_PRINCIPLE } from '@/lib/gdmt/constants';

// ==========================================================================
// GDMT-08: Generic Bridge Cost Display
// Protocol v3.3 Module 2, Section 2.4 -- Generic Bridge (~$15/month)
// 1. ACE inhibitor (Lisinopril) OR ARB (Losartan) -- $4/month
// 2. Beta-blocker (Carvedilol generic) -- $4/month
// 3. MRA (Spironolactone generic) -- $4/month
// 4. Metformin (if diabetic/prediabetic) -- $4/month
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

  it('shows ACE inhibitor/ARB (Lisinopril or Losartan) at $4/month', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Lisinopril or Losartan')).toBeInTheDocument();
    // All items show $4/month
    const costs = screen.getAllByText('$4/month');
    expect(costs.length).toBeGreaterThanOrEqual(4);
  });

  it('shows Beta-blocker (Carvedilol generic) at $4/month', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Carvedilol generic')).toBeInTheDocument();
  });

  it('shows MRA (Spironolactone generic) at $4/month', () => {
    render(<GenericBridge />);
    expect(screen.getByText('Spironolactone generic')).toBeInTheDocument();
  });

  it('shows Metformin at $4/month with "if diabetic/prediabetic" note', () => {
    render(<GenericBridge />);
    const metforminCells = screen.getAllByText('Metformin');
    expect(metforminCells.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/if diabetic\/prediabetic/)).toBeInTheDocument();
  });

  it('displays total approximately $15/month', () => {
    render(<GenericBridge />);
    expect(screen.getByText('~$15-16/month')).toBeInTheDocument();
  });

  it('displays key principle about generic therapy', () => {
    render(<GenericBridge />);
    expect(screen.getByText(GENERIC_BRIDGE_PRINCIPLE)).toBeInTheDocument();
  });
});
