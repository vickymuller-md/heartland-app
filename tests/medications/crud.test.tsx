import { describe, it, expect } from 'vitest';
import { addMedicationSchema } from '@/lib/medications/schema';

describe('Medication CRUD (MEDS-01)', () => {
  describe('Zod Schema Validation', () => {
    it('accepts valid medication: name, dosage, frequency, timing', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: ['morning', 'evening'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty medication name', () => {
      const result = addMedicationSchema.safeParse({
        name: '',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty dosage', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '',
        frequency: 'twice_daily',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid frequency value', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'every_other_day',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty timing array', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: [],
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid frequency values: once_daily, twice_daily, three_times_daily, four_times_daily, as_needed, weekly', () => {
      const frequencies = [
        'once_daily',
        'twice_daily',
        'three_times_daily',
        'four_times_daily',
        'as_needed',
        'weekly',
      ] as const;
      for (const frequency of frequencies) {
        const result = addMedicationSchema.safeParse({
          name: 'Test Med',
          dosage: '10 mg',
          frequency,
          timing: ['morning'],
        });
        expect(result.success, `frequency "${frequency}" should be valid`).toBe(true);
      }
    });
  });

  describe('Medication List', () => {
    it.todo('renders list of active medications');
    it.todo('renders medication name, dosage, and frequency');
    it.todo('add medication form opens in dialog');
    it.todo('edit medication updates existing record');
    it.todo('deactivating medication sets active=false');
  });
});
