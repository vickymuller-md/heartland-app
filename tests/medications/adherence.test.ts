import { describe, it, expect } from 'vitest';
import { computeAdherenceDay } from '@/lib/medications/queries';
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

  describe('Adherence Heatmap', () => {
    it.todo('renders 30-day grid with 7 columns');
    it.todo('complete days render green background');
    it.todo('partial days render yellow background');
    it.todo('missed days render gray background');
    it.todo('future days render transparent/white background');
  });
});
