/**
 * HEARTLAND Medication Tracking -- Zod Validation Schemas
 *
 * Schemas for medication CRUD, dose logging, and reminder configuration.
 * Used by Server Actions and client-side form validation.
 */

import { z } from 'zod';

/** Schema for adding or updating a medication */
export const addMedicationSchema = z.object({
  name: z.string().trim().min(1, 'Medication name is required').max(200),
  dosage: z.string().trim().min(1, 'Dosage is required').max(100),
  frequency: z.enum(
    [
      'once_daily',
      'twice_daily',
      'three_times_daily',
      'four_times_daily',
      'as_needed',
      'as_directed',
      'other',
      'weekly',
    ],
    { error: 'Please select a valid frequency' }
  ),
  frequency_instruction: z.string().trim().max(200).default(''),
  timing: z.array(z.string().trim().min(1).max(500)).max(10),
  weekly_day: z.number().int().min(0).max(6).nullable().default(null),
}).refine(input => input.frequency !== 'other' || !!input.frequency_instruction, {
  path: ['frequency_instruction'], message: 'Enter the frequency as written.',
}).refine(input => input.frequency !== 'weekly' || input.weekly_day !== null, {
  path: ['weekly_day'], message: 'Choose the confirmed weekday for a weekly medication.',
});

/** Schema for logging a dose */
export const logDoseSchema = z.object({
  medication_id: z.string().uuid(),
  scheduled_date: z.iso.date('Invalid date format'),
  dose_number: z.number().int().min(1, 'Dose number must be at least 1').max(4, 'Dose number cannot exceed 4'),
  taken: z.boolean(),
});

/** Schema for setting a medication reminder */
export const setReminderSchema = z.object({
  medication_id: z.string().uuid(),
  reminder_time: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format'),
  timezone: z.string().min(1, 'Timezone is required'),
  enabled: z.boolean(),
});

export type AddMedicationInput = z.infer<typeof addMedicationSchema>;
export type LogDoseInput = z.infer<typeof logDoseSchema>;
export type SetReminderInput = z.infer<typeof setReminderSchema>;
