import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HfrefPanel } from '@/app/(provider)/gdmt-pathway/hfref-panel';

// ==========================================================================
// GDMT-02: HFrEF Quadruple Therapy Display
// Protocol v3.3 Module 2, Section 2.1
// ==========================================================================
describe('GDMT-02: HFrEF Pathway', () => {
  it('renders 4 MedicationCards for quadruple therapy', () => {
    render(<HfrefPanel />);
    expect(screen.getByText('ARNI')).toBeInTheDocument();
    expect(screen.getByText('Beta-blocker')).toBeInTheDocument();
    expect(screen.getByText('MRA')).toBeInTheDocument();
    expect(screen.getByText('SGLT2i')).toBeInTheDocument();
  });

  it('each card shows drug class, agent, starting dose, and target dose', () => {
    render(<HfrefPanel />);
    // ARNI
    expect(screen.getByText('Sacubitril/valsartan')).toBeInTheDocument();
    expect(screen.getByText('24/26 mg BID')).toBeInTheDocument();
    expect(screen.getByText('97/103 mg BID')).toBeInTheDocument();
    // Beta-blocker
    expect(screen.getByText('Carvedilol')).toBeInTheDocument();
    expect(screen.getByText('3.125 mg BID')).toBeInTheDocument();
    expect(screen.getByText('25 mg BID (50 if >85kg)')).toBeInTheDocument();
    // MRA
    expect(screen.getByText('Spironolactone')).toBeInTheDocument();
    expect(screen.getByText('12.5-25 mg daily')).toBeInTheDocument();
    expect(screen.getByText('25-50 mg daily')).toBeInTheDocument();
    // SGLT2i
    expect(screen.getByText('Dapagliflozin or Empagliflozin')).toBeInTheDocument();
  });

  it('each card displays safety gate thresholds', () => {
    render(<HfrefPanel />);
    expect(screen.getByText('SBP >100')).toBeInTheDocument();
    expect(screen.getByText('K+ <5.5')).toBeInTheDocument();
    expect(screen.getByText('HR >50')).toBeInTheDocument();
    expect(screen.getByText('SBP >90')).toBeInTheDocument();
    expect(screen.getByText('eGFR >30')).toBeInTheDocument();
    expect(screen.getByText('K+ <5.0')).toBeInTheDocument();
    expect(screen.getByText('eGFR >20')).toBeInTheDocument();
  });

  it('all 4 cards show "Established" evidence label', () => {
    render(<HfrefPanel />);
    const badges = screen.getAllByText('Established');
    expect(badges).toHaveLength(4);
  });

  it('ARNI card shows safety gates: SBP >100, K+ <5.5', () => {
    render(<HfrefPanel />);
    expect(screen.getByText('SBP >100')).toBeInTheDocument();
    expect(screen.getByText('K+ <5.5')).toBeInTheDocument();
  });
});
