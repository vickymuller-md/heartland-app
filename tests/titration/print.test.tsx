import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintLayout } from '@/app/(provider)/titration-checklist/print-layout';

const mockProps = {
  vitals: { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0 },
  medications: [{ name: 'Carvedilol', currentDose: '25 mg BID' }],
  safetyGateResults: [
    { parameter: 'Systolic Blood Pressure', value: 120, threshold: 'SBP >= 100 mmHg', status: 'pass' as const, action: 'Safe to uptitrate', details: 'Hemodynamically stable.' },
    { parameter: 'Heart Rate', value: 70, threshold: 'HR >= 50 bpm', status: 'pass' as const, action: 'Heart rate acceptable', details: 'No adjustment needed.' },
    { parameter: 'Potassium', value: 4.0, threshold: 'K+ < 5.0 mEq/L', status: 'pass' as const, action: 'Potassium within safe range', details: 'No adjustment needed.' },
    { parameter: 'Creatinine', value: 1.0, threshold: 'Cr stable', status: 'pass' as const, action: 'Creatinine stable', details: 'No adjustment needed.' },
  ],
  titrationAction: { action: 'uptitrate' as const, details: 'SBP >= 100: UPTITRATE to next dose level' },
  providerNotes: 'Patient tolerating well',
  followUpPlan: { nextCallDate: '2026-04-01', notes: 'Recheck labs' },
  timestamp: new Date('2026-03-26T12:00:00Z'),
};

// ==========================================================================
// TITR-06: Print/PDF Export Layout
// ==========================================================================
describe('PrintLayout', () => {
  it('renders all section headings: Pre-Call Vitals, Safety Gate Assessment, Titration Decision, Follow-Up Plan', () => {
    render(<PrintLayout {...mockProps} />);
    expect(screen.getByText('Pre-Call Vitals')).toBeInTheDocument();
    expect(screen.getByText('Safety Gate Assessment')).toBeInTheDocument();
    expect(screen.getByText('Titration Decision')).toBeInTheDocument();
    expect(screen.getByText('Follow-Up Plan')).toBeInTheDocument();
  });

  it('displays clinical disclaimer text', () => {
    render(<PrintLayout {...mockProps} />);
    expect(screen.getByText(/clinical decision support resource/)).toBeInTheDocument();
  });

  it('shows entered vital sign values in summary', () => {
    render(<PrintLayout {...mockProps} />);
    expect(screen.getByText('120 mmHg')).toBeInTheDocument();
    expect(screen.getByText('70 bpm')).toBeInTheDocument();
    expect(screen.getByText('4 mEq/L')).toBeInTheDocument();
    expect(screen.getByText('1 mg/dL')).toBeInTheDocument();
  });

  it('shows safety gate results with pass status for each gate', () => {
    render(<PrintLayout {...mockProps} />);
    const passElements = screen.getAllByText('PASS');
    expect(passElements.length).toBe(4);
  });

  it('shows titration decision action text', () => {
    render(<PrintLayout {...mockProps} />);
    // The action value is rendered in an uppercase span -- DOM text is 'uptitrate'
    expect(screen.getByText('uptitrate')).toBeInTheDocument();
    expect(screen.getByText(/UPTITRATE to next dose level/)).toBeInTheDocument();
  });

  it('shows follow-up plan including next call date', () => {
    render(<PrintLayout {...mockProps} />);
    expect(screen.getByText('2026-04-01')).toBeInTheDocument();
  });

  it('includes HEARTLAND Protocol header and generation timestamp', () => {
    render(<PrintLayout {...mockProps} />);
    expect(screen.getByText('HEARTLAND Telephone Titration Checklist')).toBeInTheDocument();
    expect(screen.getByText(/Generated:/)).toBeInTheDocument();
  });

  it('print container has class hidden print:block', () => {
    render(<PrintLayout {...mockProps} />);
    const container = screen.getByTestId('print-layout');
    expect(container.className).toContain('hidden');
    expect(container.className).toContain('print:block');
  });
});
