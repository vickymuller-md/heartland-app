import { describe, it, expect } from 'vitest';
import { computeAdherenceDay } from '@/lib/medications/queries';
import { adherenceFromSchedules, medicationScheduleOn, medicationTiming, type MedicationSchedule } from '@/lib/medications/schedule';
import type { MedicationRow, MedicationLog } from '@/lib/medications/types';
import { addDays, format } from 'date-fns';

function makeMed(overrides: Partial<MedicationRow> = {}): MedicationRow {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    patient_id: 'patient-1',
    name: 'Carvedilol',
    dosage: '25 mg',
    frequency: 'twice_daily',
    timing: ['morning', 'evening'],
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLog(overrides: Partial<MedicationLog> = {}): MedicationLog {
  return {
    id: 'log-1',
    medication_id: '550e8400-e29b-41d4-a716-446655440000',
    patient_id: 'patient-1',
    scheduled_date: '2026-03-26',
    dose_number: 1,
    taken: true,
    taken_at: '2026-03-26T08:00:00Z',
    created_at: '2026-03-26T08:00:00Z',
    ...overrides,
  };
}

describe('Adherence Visualization (MEDS-03)', () => {
  describe('Adherence Day Calculation', () => {
    const today = new Date();
    const yesterdayStr = format(addDays(today, -1), 'yyyy-MM-dd');
    const futureStr = format(addDays(today, 1), 'yyyy-MM-dd');

    it('day with all doses taken returns status complete', () => {
      const meds = [makeMed({ frequency: 'twice_daily' })];
      const logs = [
        makeLog({ dose_number: 1, taken: true, scheduled_date: yesterdayStr }),
        makeLog({ dose_number: 2, taken: true, scheduled_date: yesterdayStr }),
      ];
      const result = computeAdherenceDay(yesterdayStr, meds, logs, today);
      expect(result.status).toBe('complete');
      expect(result.totalDoses).toBe(2);
      expect(result.takenDoses).toBe(2);
    });

    it('day with some doses taken returns status partial', () => {
      const meds = [makeMed({ frequency: 'twice_daily' })];
      const logs = [makeLog({ dose_number: 1, taken: true, scheduled_date: yesterdayStr })];
      const result = computeAdherenceDay(yesterdayStr, meds, logs, today);
      expect(result.status).toBe('partial');
      expect(result.takenDoses).toBe(1);
      expect(result.totalDoses).toBe(2);
    });

    it('day with no doses logged returns status missed', () => {
      const meds = [makeMed({ frequency: 'twice_daily' })];
      const result = computeAdherenceDay(yesterdayStr, meds, [], today);
      expect(result.status).toBe('missed');
      expect(result.takenDoses).toBe(0);
      expect(result.totalDoses).toBe(2);
    });

    it('future date returns status future', () => {
      const meds = [makeMed({ frequency: 'once_daily' })];
      const result = computeAdherenceDay(futureStr, meds, [], today);
      expect(result.status).toBe('future');
    });

    it('day with no active medications returns status no_meds', () => {
      const result = computeAdherenceDay(yesterdayStr, [], [], today);
      expect(result.status).toBe('no_meds');
      expect(result.totalDoses).toBe(0);
    });

    it('calculates correct totalDoses from medication frequencies', () => {
      const meds = [
        makeMed({ id: 'med-1', frequency: 'once_daily' }),
        makeMed({ id: 'med-2', frequency: 'twice_daily' }),
      ];
      const result = computeAdherenceDay(yesterdayStr, meds, [], today);
      expect(result.totalDoses).toBe(3);
    });

    it('calculates correct takenDoses from medication_logs', () => {
      const meds = [
        makeMed({ id: 'med-1', frequency: 'once_daily' }),
        makeMed({ id: 'med-2', frequency: 'twice_daily' }),
      ];
      const logs = [
        makeLog({ medication_id: 'med-1', dose_number: 1, taken: true, scheduled_date: yesterdayStr }),
        makeLog({ medication_id: 'med-2', dose_number: 1, taken: true, scheduled_date: yesterdayStr }),
      ];
      const result = computeAdherenceDay(yesterdayStr, meds, logs, today);
      expect(result.takenDoses).toBe(2);
      expect(result.totalDoses).toBe(3);
      expect(result.status).toBe('partial');
    });
  });

  describe('Dated schedule evidence', () => {
    const original: MedicationSchedule = {
      id: 'revision-1', medication_id: 'med-1', patient_id: 'patient-1',
      starts_on: '2026-11-15', ends_before: '2026-11-20', known: true, active: true,
      name: 'Recorded item', dosage: 'Original amount', frequency: 'weekly', weekly_day: 1, timing: 'morning',
    };
    const today = '2026-11-22';

    it('counts a confirmed weekly schedule exactly once and respects creation and suspension dates', () => {
      const history = [original,
        { ...original, id: 'revision-2', starts_on: '2026-11-20', ends_before: '2026-11-21', frequency: 'daily', weekly_day: null, dosage: 'Updated amount' },
        { ...original, id: 'revision-3', starts_on: '2026-11-21', ends_before: null, active: false },
      ];
      const days = Array.from({ length: 9 }, (_, i) => '2026-11-' + (14 + i));
      expect(days.map(day => adherenceFromSchedules(day, history, [], today).totalDoses)).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0]);
      expect(medicationScheduleOn(history, 'med-1', '2026-11-16')?.dosage).toBe('Original amount');
      expect(medicationScheduleOn(history, 'med-1', '2026-11-20')?.dosage).toBe('Updated amount');
      expect(adherenceFromSchedules('2026-11-14', history, [], today).status).toBe('no_meds');
    });

    it('distinguishes ambiguous historical evidence from a known day with no dose recorded', () => {
      const interval = { ...original, frequency: 'daily' };
      const scheduled = '2026-11-16';
      expect(adherenceFromSchedules(scheduled, [interval], [], today)).toMatchObject({ totalDoses: 1, status: 'missed' });
      for (const unknown of [{ ...original, weekly_day: null }, { ...interval, active: null }, { ...interval, known: false }, { ...interval, frequency: 'as directed by care team' }]) {
        expect(adherenceFromSchedules(scheduled, [unknown], [], today)).toMatchObject({ totalDoses: 0, status: 'unconfirmed' });
      }
      expect(medicationScheduleOn([{ ...original, known: false }], 'med-1', scheduled)).toBeNull();
      expect(adherenceFromSchedules(scheduled, [interval, original], [], today).status).toBe('unconfirmed');
    });

    it('counts each scheduled medication and slot once and leaves unverified legacy logs uncredited', () => {
      const day = '2026-11-16';
      const actual = { medication_id: 'med-1', scheduled_date: day, dose_number: 1, taken: true };
      expect(adherenceFromSchedules(day, [original], [actual, actual], today)).toMatchObject({ totalDoses: 1, takenDoses: 1, status: 'complete' });
      expect(adherenceFromSchedules(day, [original], [{ ...actual, medication_id: 'other-item' }], today)).toMatchObject({ takenDoses: 0, status: 'unconfirmed' });
      expect(adherenceFromSchedules(day, [original], [{ ...actual, dose_number: 2 }], today)).toMatchObject({ takenDoses: 0, status: 'unconfirmed' });
    });

    it('uses the patient calendar on both sides of midnight during the autumn DST change', () => {
      const date = new Date('2026-11-02T04:30:00Z');
      const med = makeMed({ frequency: 'daily', created_at: '2026-11-02T04:15:00Z' });
      expect(computeAdherenceDay('2026-11-01', [med], [], date, 'America/New_York').totalDoses).toBe(1);
      expect(computeAdherenceDay('2026-11-02', [med], [], date, 'America/New_York').status).toBe('future');
      expect(computeAdherenceDay('2026-11-02', [med], [], date, 'UTC').totalDoses).toBe(1);
    });

    it('reads previously stored timing values without splitting free-form instructions at a comma', () => {
      expect(medicationTiming(null)).toEqual([]);
      expect(medicationTiming('["morning","bedtime"]')).toEqual(['morning', 'bedtime']);
      expect(medicationTiming('{morning,bedtime}')).toEqual(['morning', 'bedtime']);
      expect(medicationTiming('morning\nAt the time on your plan, when confirmed')).toEqual(['morning', 'At the time on your plan, when confirmed']);
      expect(medicationTiming('At the time on your plan, when confirmed')).toEqual(['At the time on your plan, when confirmed']);
    });
  });
});
