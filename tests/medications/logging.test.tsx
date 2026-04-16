import { describe, it, expect } from 'vitest';
import { logDoseSchema } from '@/lib/medications/schema';
import { FREQUENCY_DOSES_MAP } from '@/lib/medications/constants';

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
    it.todo('renders checkbox for each scheduled dose today');
    it.todo('once_daily medication shows 1 checkbox');
    it.todo('twice_daily medication shows 2 checkboxes');
    it.todo('checking a dose calls logDose Server Action');
    it.todo('unchecking a dose updates taken to false');
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
