/**
 * HEARTLAND Provider Messages -- Zod Schemas
 *
 * Validation for sendMessage server action input.
 * Uses Zod 4 (project standard).
 *
 * Requirements: MSG-01, MSG-02
 */

import { z } from 'zod';

/** Schema for sendMessage server action */
export const sendMessageSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  templateType: z.enum(
    ['dose_change', 'appointment', 'lab_order', 'general'],
    { error: 'Invalid message template type' }
  ),
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(200, 'Subject cannot exceed 200 characters'),
  body: z
    .string()
    .min(1, 'Message body is required')
    .max(2000, 'Message cannot exceed 2000 characters'),
});

/** Inferred input type for sendMessage */
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
