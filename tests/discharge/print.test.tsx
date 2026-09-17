/**
 * PrintableInstructions -- Tests
 * Requirement: DSCH-06 (tier-appropriate printable discharge instructions)
 * Source: HEARTLAND Protocol v3.3 Module 4 -- Discharge Bundle & Post-Discharge Follow-Up
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PrintableInstructions } from '@/app/(provider)/discharge/[patientId]/_components/PrintableInstructions';

// Mock react-to-print
vi.mock('react-to-print', () => ({
  useReactToPrint: () => vi.fn(),
}));

const defaultProps = {
  patientName: 'Jane Doe',
  dischargedAt: '2026-04-01T12:00:00Z',
  providerName: 'Dr. Smith',
};

describe('PrintableInstructions', () => {
  it.each([1, 2, 3] as const)('renders all 8 teach-back domains for tier %s', (facilityTier) => {
    render(<PrintableInstructions {...defaultProps} facilityTier={facilityTier} />);
    const content = screen.getByTestId('print-content');
    // Every tier prints every domain; the tier governs delivery, not availability.
    expect(within(content).getByTestId('print-domain-daily_weight')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-medications')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-warning_signs')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-what_is_hf')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-sodium_restriction')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-fluid_management')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-when_to_call')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-activity_guidance')).toBeInTheDocument();
    expect(within(content).getAllByTestId(/^print-domain-/)).toHaveLength(8);
  });

  it('includes patient name in printed header', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={1} />);
    const content = screen.getByTestId('print-content');
    expect(within(content).getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('includes discharged_at date in printed header', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={1} />);
    const content = screen.getByTestId('print-content');
    expect(within(content).getByText(/April 1, 2026/)).toBeInTheDocument();
  });

  it('includes provider contact information', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={1} />);
    const content = screen.getByTestId('print-content');
    expect(within(content).getByText(/Dr. Smith/)).toBeInTheDocument();
  });
});
