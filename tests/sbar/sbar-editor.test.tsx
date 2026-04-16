/**
 * SbarEditor -- Tests
 * Requirements: SBAR-01 (structured 4-section form), SBAR-03 (editable sections)
 * Source: HEARTLAND Protocol v3.3 -- Phase 15 SBAR Handoff Generator
 *
 * Tests for the SBAR editor component that displays 4 labeled sections
 * (Situation, Background, Assessment, Recommendation) with editable
 * textareas pre-filled from patient data.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SbarEditor } from '@/app/(provider)/patients/[patientId]/sbar/_components/sbar-editor';

// Mock react-to-print
vi.mock('react-to-print', () => ({
  useReactToPrint: () => vi.fn(),
}));

const defaultProps = {
  initialData: {
    situation: 'Patient is at moderate risk.',
    background: 'Digital Track. Lisinopril 10mg daily.',
    assessment: 'HEARTLAND Risk Tier: Moderate.',
    recommendation: 'Refer to cardiology within 2 weeks.',
  },
  patientName: 'John Smith',
  patientId: 'abc-123',
};

describe('SbarEditor', () => {
  it('renders 4 labeled textareas (Situation, Background, Assessment, Recommendation)', () => {
    render(<SbarEditor {...defaultProps} />);
    expect(screen.getByLabelText(/Situation/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Background/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Assessment/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recommendation/)).toBeInTheDocument();
  });

  it('each textarea is pre-filled with corresponding initialData value', () => {
    render(<SbarEditor {...defaultProps} />);
    expect(screen.getByLabelText(/Situation/)).toHaveValue(defaultProps.initialData.situation);
    expect(screen.getByLabelText(/Background/)).toHaveValue(defaultProps.initialData.background);
    expect(screen.getByLabelText(/Assessment/)).toHaveValue(defaultProps.initialData.assessment);
    expect(screen.getByLabelText(/Recommendation/)).toHaveValue(defaultProps.initialData.recommendation);
  });

  it('typing in Situation textarea updates its value', () => {
    render(<SbarEditor {...defaultProps} />);
    const textarea = screen.getByLabelText(/Situation/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated situation text' } });
    expect(textarea).toHaveValue('Updated situation text');
  });

  it('renders a button with text "Export PDF" or "Print / Export PDF"', () => {
    render(<SbarEditor {...defaultProps} />);
    const button = screen.getByRole('button', { name: /export pdf/i });
    expect(button).toBeInTheDocument();
  });

  it('renders a back navigation link pointing to /patients/[patientId]', () => {
    render(<SbarEditor {...defaultProps} />);
    const link = screen.getByRole('link', { name: /back/i });
    expect(link).toHaveAttribute('href', '/patients/abc-123');
  });
});
