import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MraReference } from '@/components/gdmt/mra-reference';

// ==========================================================================
// MRA label reference — steroidal agents
// Source: ALDACTONE label §2.2 and 2022 AHA/ACC/HFSA p. e932 (eGFR 30-50
// dose reduction); INSPRA label §2.1, §2.3, §2.4, §4 and Table 1 (eplerenone)
// ==========================================================================
describe('MraReference: steroidal MRA', () => {
  it('shows the spironolactone eGFR 30-50 dose reduction', () => {
    render(<MraReference />);
    expect(screen.getByText(/eGFR 30-50/)).toBeInTheDocument();
    expect(screen.getByText(/half the dose or 25 mg every other day/i)).toBeInTheDocument();
  });

  it('lists eplerenone with its dose and both label contraindications', () => {
    render(<MraReference />);
    expect(screen.getByText('Eplerenone')).toBeInTheDocument();
    expect(screen.getByText(/^25 mg once daily \(INSPRA label 2\.1\)$/)).toBeInTheDocument();
    expect(screen.getByText(/creatinine clearance <=30 mL\/min/i)).toBeInTheDocument();
    expect(screen.getByText(/potassium >5\.5 mEq\/L/i)).toBeInTheDocument();
  });

  it('renders the four eplerenone potassium bands including >=6.0', () => {
    render(<MraReference />);
    expect(screen.getByText('<5.0')).toBeInTheDocument();
    expect(screen.getByText('5.0-5.4')).toBeInTheDocument();
    expect(screen.getByText('5.5-5.9')).toBeInTheDocument();
    expect(screen.getByText('>=6.0')).toBeInTheDocument();
  });
});
