/**
 * HEARTLAND Track B Batch Entry -- Zod Schema
 *
 * Validates a single row parsed from prefixed FormData keys (row_0_weight, row_1_sbp, etc.)
 * Uses z.preprocess for optional fields -- empty string maps to undefined (same pattern as schema.ts).
 */

import { z } from 'zod';

// Re-use the existing optionalSpo2 pattern: empty string -> undefined -> optional number
const optionalNumeric = z.preprocess(
  (val) => (val === '' || val === undefined || val === null ? undefined : val),
  z.coerce.number().optional()
);

/**
 * Schema for one row of the batch grid.
 * Weight and SBP are required; all others are optional (allows partial rows that pass blank-row detection).
 * Full clinical range validation is intentionally relaxed here --
 * the batch action calls providerVitalsSchema per-row after blank-row detection.
 */
export const batchRowSchema = z.object({
  weight: optionalNumeric,
  weightUnit: z.enum(['lbs', 'kg']).optional().default('lbs'),
  sbp: optionalNumeric,
  dbp: optionalNumeric,
  heartRate: optionalNumeric,
  spo2: optionalNumeric,
  dyspnea: z.coerce.number().int().min(0).max(3).optional().default(0),
  recordedAt: z.string().optional(),
});

export type BatchRowInput = z.infer<typeof batchRowSchema>;

const BATCH_ROWS = 7;

/**
 * Extracts 7 row objects from flat FormData prefixed keys.
 * row_0_weight, row_0_sbp, ..., row_6_dyspnea
 */
export function parseBatchFormData(formData: FormData): Record<string, FormDataEntryValue | null>[] {
  return Array.from({ length: BATCH_ROWS }, (_, i) => ({
    weight: formData.get(`row_${i}_weight`),
    weightUnit: formData.get(`row_${i}_weightUnit`) ?? 'lbs',
    sbp: formData.get(`row_${i}_sbp`),
    dbp: formData.get(`row_${i}_dbp`),
    heartRate: formData.get(`row_${i}_heartRate`),
    spo2: formData.get(`row_${i}_spo2`),
    dyspnea: formData.get(`row_${i}_dyspnea`) ?? '0',
    recordedAt: formData.get(`row_${i}_recordedAt`),
  }));
}

/**
 * Returns true when all measurement fields are blank -- row should be skipped server-side.
 */
export function isBlankRow(row: Record<string, FormDataEntryValue | null>): boolean {
  return ['weight', 'sbp', 'dbp', 'heartRate'].every(
    (field) => !row[field] || row[field] === ''
  );
}
