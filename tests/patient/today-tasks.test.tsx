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
  getRecentVitals: vi.fn(),
}));
vi.mock('@/lib/medications/queries', () => ({
  getPatientMedications: vi.fn(),
  getTodayLogs: vi.fn(),
  computeAdherenceDay: vi.fn(),
}));
vi.mock('@/lib/education/queries', () => ({
  getEducationProgress: vi.fn(),
}));

import { getTodayTaskStatus } from '@/lib/patient/today-tasks';
import { getRecentVitals } from '@/lib/vitals/queries';
import { getPatientMedications, getTodayLogs, computeAdherenceDay } from '@/lib/medications/queries';
import { getEducationProgress } from '@/lib/education/queries';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockSupabase = {} as SupabaseClient;
const patientId = 'patient-123';

describe('getTodayTaskStatus (PTUX-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(getRecentVitals).mockResolvedValue([]);
    vi.mocked(getPatientMedications).mockResolvedValue([]);
    vi.mocked(getTodayLogs).mockResolvedValue([]);
    vi.mocked(computeAdherenceDay).mockReturnValue({
      date: '2026-03-27',
      totalDoses: 0,
      takenDoses: 0,
      status: 'no_meds',
    });
    vi.mocked(getEducationProgress).mockResolvedValue([]);
  });

  it('returns vitalsLogged=true when vitals recorded today', async () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    vi.mocked(getRecentVitals).mockResolvedValue([
      {
        id: 'v1',
        patient_id: patientId,
        recorded_at: todayISO + 'T14:30:00.000Z',
        weight_lbs: 180,
        sbp: 120,
        dbp: 80,
        heart_rate: 72,
        spo2: 96,
        source: 'patient_app',
      },
    ]);

    const result = await getTodayTaskStatus(mockSupabase, patientId, 'UTC');
    expect(result.vitalsLogged).toBe(true);
  });

  it('returns vitalsLogged=false when no vitals today', async () => {
    vi.mocked(getRecentVitals).mockResolvedValue([]);
    const result = await getTodayTaskStatus(mockSupabase, patientId);
    expect(result.vitalsLogged).toBe(false);
  });

  it('returns medsTaken and medsTotal from computeAdherenceDay', async () => {
    vi.mocked(computeAdherenceDay).mockReturnValue({
      date: '2026-03-27',
      totalDoses: 4,
      takenDoses: 2,
      status: 'partial',
    });

    const result = await getTodayTaskStatus(mockSupabase, patientId);
    expect(result.medsTaken).toBe(2);
    expect(result.medsTotal).toBe(4);
  });

  it('returns educationRemaining as count of incomplete progress', async () => {
    vi.mocked(getEducationProgress).mockResolvedValue([
      { id: 'e1', patient_id: patientId, domain_id: 'daily_weight', completed: true, completed_at: '2026-03-27', attempts: 1, created_at: '2026-03-27' },
      { id: 'e2', patient_id: patientId, domain_id: 'medications', completed: false, completed_at: null, attempts: 0, created_at: '2026-03-27' },
      { id: 'e3', patient_id: patientId, domain_id: 'warning_signs', completed: false, completed_at: null, attempts: 0, created_at: '2026-03-27' },
    ]);

    const result = await getTodayTaskStatus(mockSupabase, patientId);
    expect(result.educationRemaining).toBe(2);
  });

  it('runs all queries in parallel via Promise.all', async () => {
    await getTodayTaskStatus(mockSupabase, patientId);
    // All four query functions should have been called
    expect(getRecentVitals).toHaveBeenCalledOnce();
    expect(getPatientMedications).toHaveBeenCalledOnce();
    expect(getTodayLogs).toHaveBeenCalledOnce();
    expect(getEducationProgress).toHaveBeenCalledOnce();
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
