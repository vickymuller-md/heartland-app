import { z } from 'zod';

/**
 * Per-step Zod schemas for the Titration Checklist wizard.
 * Each step validates its own fields independently.
 */

// Step 1: Pre-Call Vitals
export const vitalsSchema = z.object({
  sbp: z.number({ error: 'SBP is required' }).min(50, 'SBP must be at least 50').max(250, 'SBP must be at most 250'),
  hr: z.number({ error: 'Heart rate is required' }).min(20, 'HR must be at least 20').max(200, 'HR must be at most 200'),
  potassium: z.number({ error: 'Potassium is required' }).min(2.0, 'K+ must be at least 2.0').max(8.0, 'K+ must be at most 8.0'),
  creatinine: z.number({ error: 'Creatinine is required' }).min(0.1, 'Cr must be at least 0.1').max(15.0, 'Cr must be at most 15.0'),
  creatinineBaseline: z.number().min(0.1, 'Baseline Cr must be at least 0.1').max(15.0, 'Baseline Cr must be at most 15.0').optional(),
  egfr: z.number().min(1, 'eGFR must be at least 1').max(200, 'eGFR must be at most 200').optional(),
});

// Step 2: Medication Review
export const medicationReviewSchema = z.object({
  medications: z.array(
    z.object({
      name: z.string().min(1, 'Medication name is required'),
      currentDose: z.string(),
    })
  ),
});

// Step 5: Follow-Up Plan
export const followUpSchema = z.object({
  nextCallDate: z.string().optional(),
  notes: z.string().optional(),
});

// Step 1 supplement: Patient-reported symptoms (optional)
export const symptomsSchema = z.object({
  symptomsReported: z.string().optional(),
});

// Combined form data type (all steps)
export const titrationFormSchema = z.object({
  ...vitalsSchema.shape,
  ...symptomsSchema.shape,
  ...medicationReviewSchema.shape,
  ...followUpSchema.shape,
});

export type VitalsFormData = z.infer<typeof vitalsSchema>;
export type MedicationReviewFormData = z.infer<typeof medicationReviewSchema>;
export type FollowUpFormData = z.infer<typeof followUpSchema>;
export type TitrationFormData = z.infer<typeof titrationFormSchema>;
