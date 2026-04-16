/**
 * HEARTLAND Patient Vitals — Zod Validation Schema
 *
 * Combined vitals + symptoms form validation.
 * Uses z.coerce.number() for all numeric fields because HTML forms submit strings.
 * Clinical ranges from HEARTLAND Protocol v3.3 Module 5.
 */

import { z } from 'zod';

/**
 * SpO2 is optional -- the form field may be empty string or undefined.
 * We use a custom preprocessor to handle empty-string -> undefined conversion
 * before coercing to number.
 */
const optionalSpo2 = z.preprocess(
  (val) => {
    if (val === '' || val === undefined || val === null) return undefined;
    return val;
  },
  z.coerce
    .number({ error: 'SpO2 must be a number' })
    .min(50, 'SpO2 must be at least 50%')
    .max(100, 'SpO2 cannot exceed 100%')
    .optional()
);

/**
 * Orthopnea is boolean, but HTML forms submit strings.
 * Preprocess to convert 'true'/'false' strings to actual booleans.
 */
const coercedBoolean = z.preprocess(
  (val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return val;
  },
  z.boolean({ error: 'Must be yes or no' })
);

/**
 * Symptom severity: coerce to number, then constrain to 0-3.
 */
const symptomSeverity = z.coerce
  .number({ error: 'Severity must be a number' })
  .int('Severity must be a whole number')
  .min(0, 'Severity must be 0-3')
  .max(3, 'Severity must be 0-3');

export const vitalsSchema = z.object({
  // Vitals
  weight: z.coerce
    .number({ error: 'Weight is required' })
    .min(50, 'Weight must be at least 50')
    .max(700, 'Weight cannot exceed 700'),
  weightUnit: z.enum(['lbs', 'kg'], {
    error: 'Please select lbs or kg',
  }),
  sbp: z.coerce
    .number({ error: 'Systolic BP is required' })
    .min(60, 'Systolic BP must be at least 60 mmHg')
    .max(260, 'Systolic BP cannot exceed 260 mmHg'),
  dbp: z.coerce
    .number({ error: 'Diastolic BP is required' })
    .min(30, 'Diastolic BP must be at least 30 mmHg')
    .max(160, 'Diastolic BP cannot exceed 160 mmHg'),
  heartRate: z.coerce
    .number({ error: 'Heart rate is required' })
    .min(30, 'Heart rate must be at least 30 bpm')
    .max(220, 'Heart rate cannot exceed 220 bpm'),
  spo2: optionalSpo2,

  // Symptoms
  dyspnea: symptomSeverity,
  edema: symptomSeverity,
  orthopnea: coercedBoolean,
  fatigue: symptomSeverity,
});

/**
 * Provider vitals schema -- same fields as patient schema plus optional recordedAt.
 * recordedAt allows providers to backdate entries when transcribing paper diaries.
 */
export const providerVitalsSchema = vitalsSchema.extend({
  recordedAt: z.string().datetime().optional(),
});

export type VitalsInput = z.infer<typeof vitalsSchema>;
export type ProviderVitalsInput = z.infer<typeof providerVitalsSchema>;
