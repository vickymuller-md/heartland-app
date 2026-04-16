/**
 * Zod schema validation tests for vitals + symptoms form
 * Requirements: VITL-01 (weight), VITL-02 (BP/HR), VITL-03 (SpO2), VITL-04 (symptoms)
 * Source: HEARTLAND Protocol v3.3, Module 5
 */

import { vitalsSchema } from '@/lib/vitals/schema';

describe('vitalsSchema', () => {
  // Helper: valid form data (all fields as strings, like HTML form submission)
  const validData = {
    weight: '165',
    weightUnit: 'lbs',
    sbp: '120',
    dbp: '80',
    heartRate: '72',
    spo2: '97',
    dyspnea: '0',
    edema: '0',
    orthopnea: 'false',
    fatigue: '0',
  };

  describe('weight validation (VITL-01)', () => {
    it('accepts valid weight in lbs (e.g., 165.0)', () => {
      const result = vitalsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.weight).toBe(165);
      }
    });

    it('accepts valid weight in kg (e.g., 75.0) and marks unit as kg', () => {
      const result = vitalsSchema.safeParse({
        ...validData,
        weight: '75',
        weightUnit: 'kg',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.weightUnit).toBe('kg');
      }
    });

    it('rejects weight below 50', () => {
      const result = vitalsSchema.safeParse({ ...validData, weight: '49' });
      expect(result.success).toBe(false);
    });

    it('rejects weight above 700', () => {
      const result = vitalsSchema.safeParse({ ...validData, weight: '701' });
      expect(result.success).toBe(false);
    });
  });

  describe('blood pressure validation (VITL-02)', () => {
    it('accepts valid BP: sbp 120, dbp 80', () => {
      const result = vitalsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sbp).toBe(120);
        expect(result.data.dbp).toBe(80);
      }
    });

    it('rejects sbp below 60', () => {
      const result = vitalsSchema.safeParse({ ...validData, sbp: '59' });
      expect(result.success).toBe(false);
    });

    it('rejects sbp above 260', () => {
      const result = vitalsSchema.safeParse({ ...validData, sbp: '261' });
      expect(result.success).toBe(false);
    });

    it('rejects dbp below 30', () => {
      const result = vitalsSchema.safeParse({ ...validData, dbp: '29' });
      expect(result.success).toBe(false);
    });

    it('rejects dbp above 160', () => {
      const result = vitalsSchema.safeParse({ ...validData, dbp: '161' });
      expect(result.success).toBe(false);
    });
  });

  describe('heart rate validation (VITL-02)', () => {
    it('accepts valid heart rate (e.g., 72)', () => {
      const result = vitalsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.heartRate).toBe(72);
      }
    });

    it('rejects heart rate below 30', () => {
      const result = vitalsSchema.safeParse({ ...validData, heartRate: '29' });
      expect(result.success).toBe(false);
    });

    it('rejects heart rate above 220', () => {
      const result = vitalsSchema.safeParse({
        ...validData,
        heartRate: '221',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('SpO2 validation (VITL-03)', () => {
    it('accepts SpO2 as optional (undefined)', () => {
      const { spo2, ...noSpo2 } = validData;
      const result = vitalsSchema.safeParse(noSpo2);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spo2).toBeUndefined();
      }
    });

    it('accepts SpO2 as optional (empty string)', () => {
      const result = vitalsSchema.safeParse({ ...validData, spo2: '' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spo2).toBeUndefined();
      }
    });

    it('accepts valid SpO2 (e.g., 97)', () => {
      const result = vitalsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.spo2).toBe(97);
      }
    });

    it('rejects SpO2 below 50', () => {
      const result = vitalsSchema.safeParse({ ...validData, spo2: '49' });
      expect(result.success).toBe(false);
    });

    it('rejects SpO2 above 100', () => {
      const result = vitalsSchema.safeParse({ ...validData, spo2: '101' });
      expect(result.success).toBe(false);
    });
  });

  describe('symptom severity (VITL-04)', () => {
    it('accepts symptom severity values 0-3 for dyspnea, edema, fatigue', () => {
      for (const val of ['0', '1', '2', '3']) {
        const result = vitalsSchema.safeParse({
          ...validData,
          dyspnea: val,
          edema: val,
          fatigue: val,
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts orthopnea as boolean', () => {
      const resultTrue = vitalsSchema.safeParse({
        ...validData,
        orthopnea: 'true',
      });
      expect(resultTrue.success).toBe(true);
      if (resultTrue.success) {
        expect(resultTrue.data.orthopnea).toBe(true);
      }

      const resultFalse = vitalsSchema.safeParse({
        ...validData,
        orthopnea: 'false',
      });
      expect(resultFalse.success).toBe(true);
      if (resultFalse.success) {
        expect(resultFalse.data.orthopnea).toBe(false);
      }
    });

    it('rejects symptom severity outside 0-3 range', () => {
      const result = vitalsSchema.safeParse({ ...validData, dyspnea: '4' });
      expect(result.success).toBe(false);
    });
  });

  describe('coercion (HTML forms submit strings)', () => {
    it('coerces string form values to numbers', () => {
      const result = vitalsSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.weight).toBe('number');
        expect(typeof result.data.sbp).toBe('number');
        expect(typeof result.data.dbp).toBe('number');
        expect(typeof result.data.heartRate).toBe('number');
        expect(typeof result.data.spo2).toBe('number');
        expect(typeof result.data.dyspnea).toBe('number');
      }
    });
  });
});
