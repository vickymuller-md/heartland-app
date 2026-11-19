/**
 * TodayTasksChecklist Component + getTodayTaskStatus -- Tests
 * Requirement: PTUX-03
 * Source: HEARTLAND Protocol v3.3 -- Phase 25 Patient Onboarding UX
 *
 * PTUX-03: Today page shows checklist with vitals, medications, education status
 * - Vitals: done (CheckCircle2) when logged, pending (Circle) when not
 * - Medications: X of Y taken detail text, done when all taken
 * - Education: done when 0 remaining, N module(s) remaining otherwise
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TodayTasksChecklist } from '@/app/(patient)/today/_components/today-tasks-checklist';

// Mock the query dependencies for getTodayTaskStatus unit tests
vi.mock('@/lib/vitals/queries', () => ({
  hasVitalWithinDay: vi.fn(),
}));
vi.mock('@/lib/medications/queries', () => ({
  getAdherenceForRange: vi.fn(),
}));
vi.mock('@/lib/education/queries', () => ({
  getEducationSummary: vi.fn(),
}));

import { getTodayTaskStatus } from '@/lib/patient/today-tasks';
import { hasVitalWithinDay } from '@/lib/vitals/queries';
import { getAdherenceForRange } from '@/lib/medications/queries';
import { getEducationSummary } from '@/lib/education/queries';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockSupabase = {} as SupabaseClient;
const patientId = 'patient-123';

describe('getTodayTaskStatus (PTUX-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(hasVitalWithinDay).mockResolvedValue(false);
    vi.mocked(getAdherenceForRange).mockResolvedValue([{
      date: '2026-03-27',
      totalDoses: 0,
      takenDoses: 0,
      status: 'no_meds',
    }]);
    vi.mocked(getEducationSummary).mockResolvedValue({ totalDomains: 8, completedDomains: 0, completionRate: 0, domains: [] });
  });

  it('returns vitalsLogged=true when vitals recorded today', async () => {
    vi.mocked(hasVitalWithinDay).mockResolvedValue(true);

    const result = await getTodayTaskStatus(mockSupabase, patientId, 'UTC');
    expect(result.vitalsLogged).toBe(true);
  });

  it('returns vitalsLogged=false when no vitals today', async () => {
    vi.mocked(hasVitalWithinDay).mockResolvedValue(false);
    const result = await getTodayTaskStatus(mockSupabase, patientId);
    expect(result.vitalsLogged).toBe(false);
  });

  it('returns medsTaken and medsTotal from the dated schedule', async () => {
    vi.mocked(getAdherenceForRange).mockResolvedValue([{
      date: '2026-03-27',
      totalDoses: 4,
      takenDoses: 2,
      status: 'partial',
    }]);

    const result = await getTodayTaskStatus(mockSupabase, patientId);
    expect(result.medsTaken).toBe(2);
    expect(result.medsTotal).toBe(4);
  });

  it('counts all eight offered modules before any attempt and only outstanding modules afterwards', async () => {
    expect((await getTodayTaskStatus(mockSupabase, patientId)).educationRemaining).toBe(8);
    vi.mocked(getEducationSummary).mockResolvedValue({ totalDomains: 8, completedDomains: 2, completionRate: 25, domains: [] });
    expect((await getTodayTaskStatus(mockSupabase, patientId)).educationRemaining).toBe(6);
  });

  it('runs all queries in parallel via Promise.all', async () => {
    await getTodayTaskStatus(mockSupabase, patientId);
    // All four query functions should have been called
    expect(hasVitalWithinDay).toHaveBeenCalledOnce();
    expect(getAdherenceForRange).toHaveBeenCalledOnce();
    expect(getEducationSummary).toHaveBeenCalledOnce();
  });
});

describe('TodayTasksChecklist (PTUX-03)', () => {
  it("renders Today's Tasks heading", () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={0}
        medsTotal={0}
        educationRemaining={0}
      />
    );
    expect(screen.getByText("Today's Tasks")).toBeInTheDocument();
  });

  it('shows vitals task as done when vitalsLogged=true', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={true}
        medsTaken={0}
        medsTotal={0}
        educationRemaining={0}
      />
    );
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows vitals task as pending when vitalsLogged=false', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={0}
        medsTotal={0}
        educationRemaining={0}
      />
    );
    expect(screen.getByText('Not logged yet')).toBeInTheDocument();
  });

  it('shows meds X of Y taken in detail text', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={2}
        medsTotal={4}
        educationRemaining={0}
      />
    );
    expect(screen.getByText('2 of 4 taken')).toBeInTheDocument();
  });

  it('shows meds as done when medsTaken equals medsTotal', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={4}
        medsTotal={4}
        educationRemaining={0}
      />
    );
    expect(screen.getByText('All taken')).toBeInTheDocument();
  });

  it.each([0, 2])('keeps the medication task open when a schedule is unconfirmed and all %i known slots are recorded', count => {
    render(<TodayTasksChecklist vitalsLogged medsTaken={count} medsTotal={count} medsScheduleUnconfirmed educationRemaining={0} />);
    expect(screen.getByText('Medication task pending')).toBeInTheDocument();
    expect(screen.queryByText('All taken')).not.toBeInTheDocument();
  });

  it('shows education as done when educationRemaining=0', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={0}
        medsTotal={0}
        educationRemaining={0}
      />
    );
    expect(screen.getByText('All modules complete')).toBeInTheDocument();
  });

  it('shows education N module(s) remaining when educationRemaining > 0', () => {
    render(
      <TodayTasksChecklist
        vitalsLogged={false}
        medsTaken={0}
        medsTotal={0}
        educationRemaining={3}
      />
    );
    expect(screen.getByText('3 module(s) remaining')).toBeInTheDocument();
  });
});
