/**
 * Implementation Tier Selector -- Zod Validation Schema
 *
 * 8 required category fields, each validated as TierLevel (1|2|3).
 * Protocol v3.3 Module 8.
 */

import { z } from 'zod';

const tierLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const tierAssessmentSchema = z.object({
  riskStratification: tierLevelSchema,
  gdmt: tierLevelSchema,
  monitoring: tierLevelSchema,
  dischargeEducation: tierLevelSchema,
  followUp: tierLevelSchema,
  staffing: tierLevelSchema,
  chw: tierLevelSchema,
  financial: tierLevelSchema,
});

export type TierAssessmentForm = z.infer<typeof tierAssessmentSchema>;
