/**
 * PatientCard Setup Status Badge -- Tests
 * Requirements: ONBD-05
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * ONBD-05: PatientCard shows amber "Setup incomplete" badge when
 *          patient.setup_complete is false. Badge absent when true.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientCard } from '@/app/(provider)/dashboard/_components/patient-card';
import type { PatientWithStatus } from '@/lib/dashboard/types';

// Mock next/link to avoid router context requirement
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    <a href={href}>{children}</a>,
}));

function buildMockPatient(overrides: Partial<PatientWithStatus> = {}): PatientWithStatus {
  return {
    id: 'p-test',
    full_name: 'Test Patient',
    risk_tier: 'moderate',
    track_assignment: 'A',
    status: 'stable',
    open_alert_count: 0,
    last_vitals_at: '2026-03-27T12:00:00Z',
    latest_flags: null,
    setup_complete: false,
    ...overrides,
  };
}

describe('PatientCard setup badge (ONBD-05)', () => {
  it('renders amber "Setup incomplete" badge when patient.setup_complete is false', () => {
    render(<PatientCard patient={buildMockPatient({ setup_complete: false })} />);
    expect(screen.getByText('Setup incomplete')).toBeDefined();
  });

  it('does NOT render "Setup incomplete" badge when patient.setup_complete is true', () => {
    render(<PatientCard patient={buildMockPatient({ setup_complete: true })} />);
    expect(screen.queryByText('Setup incomplete')).toBeNull();
  });
});
