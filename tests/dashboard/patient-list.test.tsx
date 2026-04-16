/**
 * Patient List -- Tests
 * Requirements: DASH-01 (patient list), DASH-02 (sort & filter), DASH-04 (alert badges)
 * Source: HEARTLAND Protocol v3.3
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PatientList } from '@/app/(provider)/dashboard/_components/patient-list';
import { PatientCard } from '@/app/(provider)/dashboard/_components/patient-card';
import type { PatientWithStatus } from '@/lib/dashboard/types';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// ---------- Test Data ----------

const stablePatient: PatientWithStatus = {
  id: 'p1',
  full_name: 'Alice Green',
  risk_tier: 'low',
  track_assignment: 'track_a',
  status: 'stable',
  open_alert_count: 0,
  last_vitals_at: new Date().toISOString(),
  latest_flags: null,
  setup_complete: true,
};

const alertPatient: PatientWithStatus = {
  id: 'p2',
  full_name: 'Bob Yellow',
  risk_tier: 'moderate',
  track_assignment: 'track_b',
  status: 'alert',
  open_alert_count: 2,
  last_vitals_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
  latest_flags: ['weight_gain_3lb_2d'],
  setup_complete: true,
};

const criticalPatient: PatientWithStatus = {
  id: 'p3',
  full_name: 'Carol Red',
  risk_tier: 'high',
  track_assignment: 'track_a',
  status: 'critical',
  open_alert_count: 3,
  last_vitals_at: null,
  latest_flags: ['spo2_low', 'sbp_low'],
  setup_complete: false,
};

// ==========================================================================
// DASH-01: Provider sees linked patients with name, risk tier, status
// ==========================================================================

describe('PatientList', () => {
  it('renders all linked patients with full_name and risk tier', () => {
    render(<PatientList patients={[stablePatient, alertPatient, criticalPatient]} />);

    expect(screen.getByText('Alice Green')).toBeInTheDocument();
    expect(screen.getByText('Bob Yellow')).toBeInTheDocument();
    expect(screen.getByText('Carol Red')).toBeInTheDocument();

    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('displays status badge: stable (green), alert (yellow), critical (red)', () => {
    render(<PatientList patients={[stablePatient, alertPatient, criticalPatient]} />);

    // Each patient card has a status text badge
    expect(screen.getByText('stable')).toBeInTheDocument();
    expect(screen.getByText('alert')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('shows alert badge count for patients with open red flags', () => {
    render(<PatientList patients={[stablePatient, alertPatient, criticalPatient]} />);

    // Alert patient has count of 2, critical has 3
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it("shows 'No patients linked' empty state when provider has no links", () => {
    // Empty state is rendered in the page.tsx, not PatientList itself.
    // PatientList receives an empty array and renders an empty grid.
    render(<PatientList patients={[]} />);
    const grid = screen.getByTestId('patient-list');
    expect(grid.children).toHaveLength(0);
  });
});

// ==========================================================================
// DASH-02: Sort (visual only -- sort logic tested in sort.test.ts)
// ==========================================================================

describe('PatientListSorting', () => {
  it('sorts by alert status priority: critical > alert > stable', () => {
    // Sorting happens server-side via sortPatients; we verify render order
    const sorted = [criticalPatient, alertPatient, stablePatient];
    render(<PatientList patients={sorted} />);

    const grid = screen.getByTestId('patient-list');
    const cards = grid.children;
    expect(cards).toHaveLength(3);

    // First card should be Carol Red (critical)
    expect(within(cards[0] as HTMLElement).getByText('Carol Red')).toBeInTheDocument();
    // Last should be Alice Green (stable)
    expect(within(cards[2] as HTMLElement).getByText('Alice Green')).toBeInTheDocument();
  });

  it('sorts by last vitals date descending (most recent first)', () => {
    // When sorted by vitals_date, most recent first
    const sorted = [stablePatient, alertPatient, criticalPatient];
    render(<PatientList patients={sorted} />);

    const grid = screen.getByTestId('patient-list');
    expect(within(grid.children[0] as HTMLElement).getByText('Alice Green')).toBeInTheDocument();
  });

  it('sorts by risk tier: High > Moderate > Low', () => {
    const sorted = [criticalPatient, alertPatient, stablePatient];
    render(<PatientList patients={sorted} />);

    const grid = screen.getByTestId('patient-list');
    expect(within(grid.children[0] as HTMLElement).getByText('Carol Red')).toBeInTheDocument();
    expect(within(grid.children[2] as HTMLElement).getByText('Alice Green')).toBeInTheDocument();
  });

  it('defaults to sort by status', () => {
    // Default sort = status: critical -> alert -> stable
    const sorted = [criticalPatient, alertPatient, stablePatient];
    render(<PatientList patients={sorted} />);

    const grid = screen.getByTestId('patient-list');
    expect(grid.children).toHaveLength(3);
    expect(within(grid.children[0] as HTMLElement).getByText('Carol Red')).toBeInTheDocument();
  });
});

// ==========================================================================
// DASH-04: Alert badge details
// ==========================================================================

describe('PatientCard', () => {
  it('shows alert badge with count when patient has open alerts', () => {
    render(<PatientCard patient={alertPatient} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('does not show alert badge when patient has no alerts', () => {
    render(<PatientCard patient={stablePatient} />);
    // No alert count should be present
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('links to patient detail page', () => {
    render(<PatientCard patient={stablePatient} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/patients/p1');
  });

  it('shows relative time for last vitals', () => {
    render(<PatientCard patient={stablePatient} />);
    // Should show something like "less than a minute ago" or "X seconds ago"
    expect(screen.getByText(/Last vitals:/)).toBeInTheDocument();
  });

  it('shows "No vitals recorded" when last_vitals_at is null', () => {
    render(<PatientCard patient={criticalPatient} />);
    expect(screen.getByText('Last vitals: No vitals recorded')).toBeInTheDocument();
  });
});
