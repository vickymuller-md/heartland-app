/**
 * Remote Monitoring — Zod Validation Schema
 *
 * Track assignment form schema with 3 required boolean fields
 * and optional patient identification fields.
 */

import { z } from 'zod';

export const trackAssessmentSchema = z.object({
  smartphoneConnectivity: z.boolean().default(false),
  comfortableWithApps: z.boolean().default(false),
  reliableTelephone: z.boolean().default(false),
  patientName: z.string().optional(),
  mrn: z.string().optional(),
  riskScore: z.string().optional(),
});

export type TrackAssessmentForm = z.output<typeof trackAssessmentSchema>;
export type TrackAssessmentInput = z.input<typeof trackAssessmentSchema>;
