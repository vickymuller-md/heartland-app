/**
 * SbarPrintLayout -- Tests
 * Requirement: SBAR-04 (export PDF with HEARTLAND branding)
 * Source: HEARTLAND Protocol v3.3 -- Phase 15 SBAR Handoff Generator
 *
 * Tests for the print layout component that renders the SBAR
 * handoff document with proper branding and disclaimers.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SbarPrintLayout } from '@/app/(provider)/patients/[patientId]/sbar/_components/sbar-print-layout';

const defaultProps = {
  situation: 'Patient Smith is at moderate risk.',
  background: 'Digital Track. Lisinopril 10mg daily.',
  assessment: 'HEARTLAND Risk Tier: Moderate.',
  recommendation: 'Refer to cardiology within 2 weeks.',
  patientName: 'John Smith',
  generatedAt: new Date('2026-03-27T12:00:00Z'),
};

describe('SbarPrintLayout', () => {
  it('renders element with data-testid="sbar-print-layout"', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    expect(screen.getByTestId('sbar-print-layout')).toBeInTheDocument();
  });

  it('renders "HEARTLAND" in a heading', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('HEARTLAND');
  });

  it('renders the clinical decision support disclaimer text', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    expect(
      screen.getByText(/clinical decision support resource/i)
    ).toBeInTheDocument();
  });

  it('renders the patient name passed as prop', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
  });

  it('renders all 4 section labels (Situation, Background, Assessment, Recommendation)', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    expect(screen.getByText('Situation')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Assessment')).toBeInTheDocument();
    expect(screen.getByText('Recommendation')).toBeInTheDocument();
  });

  it('renders content for each section from props', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    expect(screen.getByText(defaultProps.situation)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.background)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.assessment)).toBeInTheDocument();
    expect(screen.getByText(defaultProps.recommendation)).toBeInTheDocument();
  });

  it('renders generation timestamp formatted as a date string', () => {
    render(<SbarPrintLayout {...defaultProps} />);
    // date-fns format(date, 'PPP p') produces something like "March 27th, 2026 at 12:00 PM"
    // We just check that a date-related string is present
    expect(screen.getByText(/March 27/)).toBeInTheDocument();
  });
});
