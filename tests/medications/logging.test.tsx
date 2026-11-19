import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DoseLogGrid } from '@/app/(patient)/medications/_components/dose-log-grid';
import { logDose } from '@/lib/medications/actions';
import type { MedicationSchedule } from '@/lib/medications/schedule';
import { logDoseSchema } from '@/lib/medications/schema';
import { FREQUENCY_DOSES_MAP } from '@/lib/medications/constants';

vi.mock('@/lib/medications/actions', () => ({ logDose: vi.fn() }));
const version: MedicationSchedule = {
  id: 'schedule-1', patient_id: 'patient-1', medication_id: 'med-1', active: true, known: true,
  starts_on: '2026-11-15', ends_before: null, name: 'Recorded item', dosage: 'Recorded amount',
  frequency: 'daily', timing: null, weekly_day: null,
};
const day = '2026-11-16';
function show(schedules: MedicationSchedule[] = [version]) {
  return render(<DoseLogGrid actorId={version.patient_id} calendarRevision="calendar-1" today={day} todayLogs={[]} schedules={schedules} />);
}

describe('Dose Logging (MEDS-02)', () => {
  describe('Dose Log Schema', () => {
    it('accepts valid dose log: medication_id, scheduled_date, dose_number, taken', () => {
      const result = logDoseSchema.safeParse({
        medication_id: '550e8400-e29b-41d4-a716-446655440000',
        scheduled_date: '2026-03-26',
        dose_number: 1,
        taken: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects dose_number < 1', () => {
      const result = logDoseSchema.safeParse({
        medication_id: '550e8400-e29b-41d4-a716-446655440000',
        scheduled_date: '2026-03-26',
        dose_number: 0,
        taken: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects dose_number > 4', () => {
      const result = logDoseSchema.safeParse({
        medication_id: '550e8400-e29b-41d4-a716-446655440000',
        scheduled_date: '2026-03-26',
        dose_number: 5,
        taken: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid date format', () => {
      const result = logDoseSchema.safeParse({
        medication_id: '550e8400-e29b-41d4-a716-446655440000',
        scheduled_date: '03-26-2026',
        dose_number: 1,
        taken: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Dose Log Grid', () => {
    beforeEach(() => vi.mocked(logDose).mockReset());

    it('offers only scheduled doses and preserves known timing labels', () => {
      show([{ ...version, frequency: 'twice_daily', timing: '["morning","evening"]' },
        { ...version, id: 'schedule-2', medication_id: 'med-2', frequency: 'as_needed' },
        { ...version, id: 'schedule-3', medication_id: 'med-3', frequency: 'weekly', weekly_day: 4 }]);
      expect(screen.getAllByRole('button')).toHaveLength(2);
      expect(screen.getByRole('button', { name: /Morning/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: /Evening/ })).toBeEnabled();
    });

    it('shows a weekly slot only on the confirmed weekday and explains a missing weekday', () => {
      show([{ ...version, frequency: 'weekly', weekly_day: 1 },
        { ...version, id: 'schedule-2', medication_id: 'med-2', frequency: 'weekly' }]);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByText(/Schedule pending confirmation/)).toBeVisible();
    });

    it('retains recorded instructions and leaves an unspecified clock time open', () => {
      show([{ ...version, timing: 'Use instructions in the plan, including the timing.' }]);
      expect(screen.getByText(/including the timing/)).toBeVisible();
      expect(screen.getByText(/Time pending confirmation/)).toBeVisible();
      expect(screen.getByRole('button', { name: /Dose 1, not recorded/ })).toBeEnabled();
    });

    it('shows failed persistence, retries the same local slot and lets the patient undo a confirmed mark', async () => {
      vi.mocked(logDose).mockResolvedValueOnce({ error: 'Dose recording was not confirmed.' })
        .mockResolvedValue({ success: true });
      show();
      const button = screen.getByRole('button');
      fireEvent.click(button);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('not confirmed'));
      expect(button).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
      for (const [, form] of vi.mocked(logDose).mock.calls) {
        expect(Object.fromEntries(form)).toEqual({ actor_id: version.patient_id, medication_id: version.medication_id,
          version: version.id, calendar_revision: 'calendar-1', scheduled_date: day, dose_number: '1', taken: 'true' });
      }
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'));
      expect(vi.mocked(logDose).mock.calls[2][1].get('taken')).toBe('false');
    });
  });

  describe('Frequency to Dose Count', () => {
    it('once_daily returns 1 dose per day', () => {
      expect(FREQUENCY_DOSES_MAP.once_daily).toBe(1);
    });
    it('twice_daily returns 2 doses per day', () => {
      expect(FREQUENCY_DOSES_MAP.twice_daily).toBe(2);
    });
    it('three_times_daily returns 3 doses per day', () => {
      expect(FREQUENCY_DOSES_MAP.three_times_daily).toBe(3);
    });
    it('four_times_daily returns 4 doses per day', () => {
      expect(FREQUENCY_DOSES_MAP.four_times_daily).toBe(4);
    });
    it('as_needed returns 0 scheduled doses', () => {
      expect(FREQUENCY_DOSES_MAP.as_needed).toBe(0);
    });
    it('weekly returns 1 dose on scheduled day', () => {
      expect(FREQUENCY_DOSES_MAP.weekly).toBe(1);
    });
  });
});
