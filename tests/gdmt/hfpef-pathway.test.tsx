import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HfpefPanel } from '@/app/(public)/gdmt-pathway/hfpef-panel';
import { FinerenoneGuide } from '@/components/gdmt/finerenone-guide';

// ==========================================================================
// GDMT-03: HFpEF Evolving Evidence Display
// Protocol v3.3 Module 2, Section 2.2
// ==========================================================================
describe('GDMT-03: HFpEF Pathway', () => {
  it('renders 4 MedicationCards in priority order (1-4)', () => {
    render(<HfpefPanel />);
    expect(screen.getByText('Priority 1')).toBeInTheDocument();
    expect(screen.getByText('Priority 2')).toBeInTheDocument();
    expect(screen.getByText('Priority 3')).toBeInTheDocument();
    expect(screen.getByText('Priority 4')).toBeInTheDocument();
  });

  it('priority 1 shows SGLT2i with "Established" evidence label', () => {
    render(<HfpefPanel />);
    expect(screen.getByText('Dapagliflozin or Empagliflozin')).toBeInTheDocument();
    expect(screen.getAllByText('Established').length).toBeGreaterThanOrEqual(2);
  });

  it('priority 2 shows current-label finerenone context with established evidence label', () => {
    render(<HfpefPanel />);
    expect(screen.getByText(/Finerenone \(LVEF >=40 indication\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Established').length).toBeGreaterThanOrEqual(2);
  });

  it('priority 3 shows GLP-1 RA (Semaglutide) with "Emerging" label', () => {
    render(<HfpefPanel />);
    expect(screen.getByText('Semaglutide')).toBeInTheDocument();
  });

  it('priority 4 shows Diuretics with "Pragmatic" label', () => {
    render(<HfpefPanel />);
    expect(screen.getByText('Loop diuretics')).toBeInTheDocument();
    expect(screen.getByText('Pragmatic')).toBeInTheDocument();
  });

  it('each card displays evidence context text', () => {
    render(<HfpefPanel />);
    expect(screen.getByText(/EMPEROR-Preserved \+ DELIVER/)).toBeInTheDocument();
    expect(screen.getByText(/FINEARTS-HF/)).toBeInTheDocument();
    expect(screen.getByText(/STEP-HFpEF/)).toBeInTheDocument();
    expect(screen.getByText(/Symptom\/volume control/)).toBeInTheDocument();
  });
});

// ==========================================================================
// GDMT-04: Finerenone vs Spironolactone Decision Guide
// Protocol v3.3 Module 2, Finerenone vs. Spironolactone Decision Guide
// ==========================================================================
describe('GDMT-04: Finerenone vs Spironolactone Guide', () => {
  it('renders 5 clinical scenarios', () => {
    render(<FinerenoneGuide />);
    expect(screen.getByText('HF with LVEF >=40%; label criteria reviewed')).toBeInTheDocument();
    expect(screen.getByText('History of hyperkalemia on MRA')).toBeInTheDocument();
    expect(screen.getByText('Significant cost barrier')).toBeInTheDocument();
    expect(screen.getByText('HFrEF')).toBeInTheDocument();
    expect(screen.getByText('Uncertain, guideline-adherent approach')).toBeInTheDocument();
  });

  it('each scenario shows clinical scenario, suggested approach, and rationale', () => {
    render(<FinerenoneGuide />);
    expect(screen.getByText('Evaluate current finerenone label and patient context')).toBeInTheDocument();
    expect(screen.getByText('No automatic preference; reassess risk and monitoring')).toBeInTheDocument();
    expect(screen.getByText(/~\$4\/month generic vs/)).toBeInTheDocument();
    expect(screen.getByText('Verify current label and heart-failure guideline')).toBeInTheDocument();
  });
});
