/**
 * Shared types for Phase 12: Tool Integration -- Save Results to Patient Profile
 *
 * Used by all Server Actions in actions.ts and consumed by tool pages.
 */

import { z } from 'zod';
import { effectiveLabObservationSchema } from '@/lib/labs/effective';
import { vitalsSchema } from '@/lib/titration/schema';

export const selectedLabSchema = z.object({
  state: z.enum(['available', 'missing', 'invalid', 'cancelled', 'precision-withheld']),
  reason: z.string().min(1).max(500),
  observation: effectiveLabObservationSchema.nullable(),
  prefill: z.number().finite().nonnegative().nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.state === 'missing') !== (value.observation === null)
    || (value.state === 'available') !== (value.prefill !== null)
    || value.observation?.notes != null || value.observation?.lab_facility != null) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent laboratory snapshot.' });
  }
});
export const selectedLabsSchema = z.object({
  potassium: selectedLabSchema, creatinine: selectedLabSchema, egfr: selectedLabSchema,
}).strict();
export type SelectedLabs = z.infer<typeof selectedLabsSchema>;

export const titrationNoteSchema = z.object({
  vitals: vitalsSchema.pick({ sbp: true, hr: true, creatinineBaseline: true, egfr: true }).extend({
    potassium: vitalsSchema.shape.potassium.nullable(), creatinine: vitalsSchema.shape.creatinine.nullable(),
    egfr: vitalsSchema.shape.egfr.nullable(),
    creatinineBaseline: vitalsSchema.shape.creatinineBaseline.nullable(),
  }).strict(),
  laboratorySnapshots: selectedLabsSchema.nullable(),
  sourceReadAt: z.iso.datetime({ offset: true }).nullable(),
  safetyGateResults: z.array(z.object({ parameter: z.string().min(1).max(100), status: z.enum(['pass', 'warning', 'blocked']) }).strict()).max(20),
  titrationAction: z.object({ action: z.enum(['uptitrate', 'hold', 'reduce']), details: z.string().min(1).max(1000) }).strict(),
  perDrugRecommendations: z.array(z.object({ drugClass: z.string().min(1).max(100), action: z.string().min(1).max(100), reason: z.string().max(1000) }).strict()).max(20).optional(),
  medicationChanges: z.array(z.object({ name: z.string().min(1).max(200), fromDose: z.string().max(200), toDose: z.string().max(200) }).strict()).max(50).optional(),
  symptomsReported: z.string().max(1000).optional(), providerNotes: z.string().max(2000), nextCallDate: z.string().max(100),
}).strict();

export type TitrationNoteSaveResult = SaveResult & { outcome?: 'saved' | 'not_saved' | 'unknown' };

/** Generic result type for all save operations */
export interface SaveResult {
  success: boolean;
  error?: string;
}

/** Data structure for titration note formatting */
export interface TitrationNoteData {
  vitals: {
    sbp: number;
    hr: number;
    potassium: number | null;
    creatinine: number | null;
    egfr?: number | null;               // eGFR from labs (mL/min/1.73m²)
    creatinineBaseline?: number | null; // baseline Cr for audit trail
  };
  laboratorySnapshots?: SelectedLabs | null;
  sourceReadAt?: string | null;
  safetyGateResults: Array<{ parameter: string; status: string }>;
  titrationAction: { action: string; details: string };
  perDrugRecommendations?: Array<{ drugClass: string; action: string; reason: string }>;
  medicationChanges?: Array<{ name: string; fromDose: string; toDose: string }>;
  symptomsReported?: string;
  providerNotes: string;
  nextCallDate: string;
}

/** Input type for GDMT medication save */
export interface GdmtMedicationInput {
  name: string;
  dosage: string;
  frequency: string;
}
