/**
 * CKM Input Validation Schema (Zod 4)
 *
 * Validates the four boolean CKM risk factor inputs.
 */

import { z } from 'zod/v4';

/** Zod schema for CkmInput validation */
export const ckmInputSchema = z.object({
  excessAdiposity: z.boolean(),
  metabolicRisk: z.boolean(),
  subclinicalCvd: z.boolean(),
  clinicalCvd: z.boolean(),
});

export type CkmInputSchema = z.infer<typeof ckmInputSchema>;
