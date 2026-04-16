/**
 * ContactCard -- Tests
 * Requirement: DSCH-04 (pending/completed state for follow-up contacts)
 * Source: HEARTLAND Protocol v3.3 Module 4 -- Discharge Bundle & Post-Discharge Follow-Up
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ContactCard } from '@/app/(provider)/discharge/[patientId]/_components/ContactCard';
import type { DischargeFollowup } from '@/lib/discharge/types';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// Mock server action
vi.mock('@/lib/discharge/actions', () => ({
  markContactComplete: vi.fn().mockResolvedValue({}),
}));

const baseFollowup: DischargeFollowup = {
  id: 'fu-001',
  discharge_record_id: 'dr-001',
  patient_id: 'p-001',
  provider_id: 'prov-001',
  type: 'call_48h',
  label: '48-72h Contact',
  due_at: '2026-04-02T12:00:00Z',
  purpose: 'Assess symptoms and medication adherence',
  status: 'pending',
  completed_at: null,
  contact_notes: null,
  created_at: '2026-04-01T12:00:00Z',
};

describe('ContactCard', () => {
  it('renders pending state with due date and purpose', () => {
    render(<ContactCard followup={baseFollowup} patientId="p-001" />);
    expect(screen.getByText('48-72h Contact')).toBeInTheDocument();
    expect(screen.getByText(/Apr 2, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Assess symptoms and medication adherence')).toBeInTheDocument();
  });

  it('renders completed state with completed_at timestamp and notes', () => {
    const completed: DischargeFollowup = {
      ...baseFollowup,
      status: 'completed',
      completed_at: '2026-04-03T14:30:00Z',
      contact_notes: 'Patient reports no issues',
    };
    render(<ContactCard followup={completed} patientId="p-001" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText(/Apr 3, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Patient reports no issues/)).toBeInTheDocument();
  });

  it('shows "Mark Complete" button when status is pending', () => {
    render(<ContactCard followup={baseFollowup} patientId="p-001" />);
    expect(screen.getByTestId('mark-complete-call_48h')).toBeInTheDocument();
  });

  it('does not show "Mark Complete" button when status is completed', () => {
    const completed: DischargeFollowup = {
      ...baseFollowup,
      status: 'completed',
      completed_at: '2026-04-03T14:30:00Z',
    };
    render(<ContactCard followup={completed} patientId="p-001" />);
    expect(screen.queryByTestId('mark-complete-call_48h')).not.toBeInTheDocument();
  });

  it('shows "skipped" badge when status is skipped', () => {
    const skipped: DischargeFollowup = {
      ...baseFollowup,
      status: 'skipped',
    };
    render(<ContactCard followup={skipped} patientId="p-001" />);
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('clicking Mark Complete opens notes form', async () => {
    const user = userEvent.setup();
    render(<ContactCard followup={baseFollowup} patientId="p-001" />);

    await user.click(screen.getByTestId('mark-complete-call_48h'));
    expect(screen.getByTestId('notes-form-call_48h')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Contact notes/)).toBeInTheDocument();
  });
});
