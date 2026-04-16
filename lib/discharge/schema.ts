/**
 * Discharge Checklist -- Zod Validation Schemas
 * Phase 16: DSCH-05 (discharge form), DSCH-04 (contact completion)
 *
 * Uses Zod 4 patterns: z.coerce for string inputs, 'error' for custom messages.
 */

import { z } from 'zod';

/**
 * Discharge form schema -- validates the discharge event data.
 * HTML forms submit strings; z.coerce handles number conversion for facility_tier.
 */
export const dischargeFormSchema = z.object({
  patient_id: z.uuid('Invalid patient ID'),
  discharged_at: z.string().min(1, 'Discharge date is required'),
  facility_tier: z.coerce
    .number({ error: 'Facility tier is required' })
    .pipe(
      z.literal(1).or(z.literal(2)).or(z.literal(3))
    ),
  discharge_notes: z.string().optional(),
});

export type DischargeFormInput = z.input<typeof dischargeFormSchema>;

/**
 * Contact completion schema -- validates marking a follow-up as done.
 */
export const contactCompleteSchema = z.object({
  followup_id: z.uuid('Invalid follow-up ID'),
  contact_notes: z.string().optional(),
});

export type ContactCompleteInput = z.input<typeof contactCompleteSchema>;
