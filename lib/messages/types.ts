/**
 * HEARTLAND Provider Messages -- TypeScript Types
 *
 * Types for one-way provider-to-patient structured messaging.
 * Mirrors ProviderNote pattern from lib/dashboard/types.ts.
 *
 * Requirements: MSG-01, MSG-02, MSG-04
 */

// ---------- Template Types ----------

/** Message template categories matching DB check constraint */
export type MessageTemplateType =
  | 'dose_change'
  | 'appointment'
  | 'lab_order'
  | 'general';

// ---------- Message Data ----------

/**
 * Provider message row with joined provider_name.
 * provider_name comes from profiles JOIN, not a DB column.
 */
export interface ProviderMessage {
  id: string;
  patient_id: string;
  provider_id: string;
  provider_name: string;
  template_type: MessageTemplateType;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// ---------- Template Definition ----------

/** Shape for MESSAGE_TEMPLATES constants */
export interface MessageTemplate {
  type: MessageTemplateType;
  label: string;
  defaultSubject: string;
  bodyPlaceholder: string;
}
