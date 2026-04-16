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
  it('renders 3 teach-back domains for tier 1', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={1} />);
    const content = screen.getByTestId('print-content');
    // Tier 1: Daily Weight, Medications, Warning Signs
    expect(within(content).getByTestId('print-domain-daily_weight')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-medications')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-warning_signs')).toBeInTheDocument();
    // Should NOT have tier23 domains
    expect(within(content).queryByTestId('print-domain-what_is_hf')).not.toBeInTheDocument();
    expect(within(content).queryByTestId('print-domain-sodium_restriction')).not.toBeInTheDocument();
  });

  it('renders 8 teach-back domains for tier 2', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={2} />);
    const content = screen.getByTestId('print-content');
    // All 8 domains
    expect(within(content).getByTestId('print-domain-daily_weight')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-medications')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-warning_signs')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-what_is_hf')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-sodium_restriction')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-fluid_management')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-when_to_call')).toBeInTheDocument();
    expect(within(content).getByTestId('print-domain-activity_guidance')).toBeInTheDocument();
  });

  it('renders 8 teach-back domains for tier 3', () => {
    render(<PrintableInstructions {...defaultProps} facilityTier={3} />);
    const content = screen.getByTestId('print-content');
    const domains = within(content).getAllByTestId(/^print-domain-/);
    expect(domains).toHaveLength(8);
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
