/**
 * HEARTLAND Provider Messages -- Constants
 *
 * Template definitions for structured provider messages.
 * Values must match DB check constraint in 00017_provider_messages.sql.
 *
 * Requirement: MSG-02
 */

import type { MessageTemplate, MessageTemplateType } from './types';

/** All available message templates (4 types) */
export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    type: 'dose_change',
    label: 'Dose Change',
    defaultSubject: 'Medication Dose Change',
    bodyPlaceholder:
      'e.g., Increase Lasix to 40mg starting tomorrow morning...',
  },
  {
    type: 'appointment',
    label: 'Appointment',
    defaultSubject: 'Appointment Reminder',
    bodyPlaceholder: 'e.g., Your follow-up visit is scheduled for...',
  },
  {
    type: 'lab_order',
    label: 'Lab Order',
    defaultSubject: 'Lab Work Requested',
    bodyPlaceholder:
      'e.g., Please get a BMP (potassium + creatinine) before your next visit...',
  },
  {
    type: 'general',
    label: 'General',
    defaultSubject: 'Message from your provider',
    bodyPlaceholder: 'Enter your message...',
  },
];

/** Display labels indexed by template type for quick lookup */
export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateType, string> = {
  dose_change: 'Dose Change',
  appointment: 'Appointment',
  lab_order: 'Lab Order',
  general: 'General',
};
