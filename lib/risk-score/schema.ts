/**
 * HEARTLAND Risk Score — Zod Validation Schema
 *
 * 10 boolean fields matching RiskInput interface, all defaulting to false.
 * Used by React Hook Form + zodResolver for the calculator form.
 */

import { z } from 'zod';

export const riskInputSchema = z.object({
  ageOver75: z.boolean().default(false),
  priorHfHospitalization: z.boolean().default(false),
  egfrBelow45: z.boolean().default(false),
  elevatedNatriuretic: z.boolean().default(false),
  sbpBelow100: z.boolean().default(false),
  diabetes: z.boolean().default(false),
  lvefBelow30: z.boolean().default(false),
  ckmStage3or4: z.boolean().default(false),
  distanceOver50Miles: z.boolean().default(false),
  livesAloneOrLimitedSupport: z.boolean().default(false),
});

export type RiskInputForm = z.output<typeof riskInputSchema>;
export type RiskInputFormInput = z.input<typeof riskInputSchema>;
