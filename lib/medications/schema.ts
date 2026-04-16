/**
 * HEARTLAND Medication Tracking -- Zod Validation Schemas
 *
 * Schemas for medication CRUD, dose logging, and reminder configuration.
 * Used by Server Actions and client-side form validation.
 */

import { z } from 'zod';

/** Schema for adding or updating a medication */
export const addMedicationSchema = z.object({
  name: z.string().min(1, 'Medication name is required').max(200),
  dosage: z.string().min(1, 'Dosage is required').max(100),
  frequency: z.enum(
    [
      'once_daily',
      'twice_daily',
      'three_times_daily',
      'four_times_daily',
      'as_needed',
      'weekly',
    ],
    { error: 'Please select a valid frequency' }
  ),
  timing: z.array(z.string()).min(1, 'Select at least one timing'),
});

/** Schema for logging a dose */
export const logDoseSchema = z.object({
  medication_id: z.string().uuid(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
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
