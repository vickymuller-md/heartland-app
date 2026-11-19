import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MedicationSummary } from '@/app/(provider)/patients/[patientId]/_components/medication-summary';

const { order, eq, select } = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  return { order, eq, select };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  from: () => ({ order, eq, select }),
}) }));

describe('Provider medication record', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the reported dose totals, excludes days without confirmed schedules, and preserves weekly instructions', async () => {
    order.mockResolvedValue({ data: [{ id: 'm1', name: 'Weekly item', dosage: 'Recorded strength',
      frequency: 'weekly', timing: 'Only as written, at preferred time', active: true, weekly_day: 1 }], error: null });
    render(<MedicationSummary patientId="patient-1" adherenceSummary={[
      { date: '2026-11-15', status: 'partial', takenDoses: 1, totalDoses: 2 },
      { date: '2026-11-16', status: 'unconfirmed', takenDoses: 2, totalDoses: 3 },
    ]} />);
    expect(screen.getByText(/1 of 2 scheduled doses/)).toBeVisible();
    expect(screen.getByText(/1 day has an unconfirmed schedule/)).toBeVisible();
    expect(await screen.findByText('Weekly item')).toBeVisible();
    expect(screen.getByText(/Weekly · Monday/)).toBeVisible();
    expect(screen.getByText(/Only as written, at preferred time/)).toBeVisible();
    expect(eq).toHaveBeenCalledWith('patient_id', 'patient-1');
    expect(eq).toHaveBeenCalledWith('active', true);
  });

  it('labels an unsuccessful list read and unavailable history separately', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    render(<MedicationSummary patientId="patient-2" adherenceSummary={null} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/);
    expect(screen.getByText(/30-day medication record is unavailable/)).toBeVisible();
    expect(screen.queryByText('No active medications listed')).toBeNull();
  });

  it('keeps confirmed historical doses after the last active medication is removed', async () => {
    order.mockResolvedValue({ data: [], error: null });
    render(<MedicationSummary patientId="patient-3" adherenceSummary={[
      { date: '2026-11-15', status: 'complete', takenDoses: 1, totalDoses: 1 },
    ]} />);
    expect(screen.getByText(/1 of 1 scheduled doses/)).toBeVisible();
    expect(await screen.findByText('No active medications listed')).toBeVisible();
  });
});
