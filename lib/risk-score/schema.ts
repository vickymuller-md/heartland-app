/**
 * HEARTLAND Risk Score — Zod Validation Schema
 *
 * Every factor needs an explicit answer before a result can be calculated.
 */

import { z } from 'zod';

export const RISK_FRAMEWORK_VERSION = 'HEARTLAND-3.4.1-table-1';

export const riskInputSchema = z.strictObject({
  ageOver75: z.boolean(),
  priorHfHospitalization: z.boolean(),
  egfrBelow45: z.boolean(),
  elevatedNatriuretic: z.boolean(),
  sbpBelow100: z.boolean(),
  diabetes: z.boolean(),
  lvefBelow30: z.boolean(),
  ckmStage3or4: z.boolean(),
  distanceOver50Miles: z.boolean(),
  livesAloneOrLimitedSupport: z.boolean(),
});

export type RiskInputForm = z.output<typeof riskInputSchema>;
export type RiskInputFormInput = z.input<typeof riskInputSchema>;
