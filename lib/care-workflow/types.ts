import { z } from 'zod';

export const careKindSchema = z.enum(['laboratory_order', 'referral', 'medication_access']);
export const CARE_KIND_LABELS = {
  laboratory_order: 'Laboratory request', referral: 'Referral follow-up', medication_access: 'Medication access follow-up',
} as const;
export const careAnalyteSchema = z.enum(['potassium', 'creatinine', 'egfr', 'bun', 'bnp', 'nt_probnp',
  'hba1c', 'glucose', 'sodium', 'hemoglobin', 'ferritin', 'tsat', 'ldl']);
const instant = z.iso.datetime({ offset: true }).refine((value) =>
  (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1].length ?? 0) <= 6, 'Use database timestamp precision.');
// A receipt decoder must never rewrite a frozen server payload (including whitespace).
const evidenceText = z.string().refine((value) => [...value].length >= 3 && [...value].length <= 1000);
// PostgreSQL uuid accepts every canonical GUID; version bits are not authorization.
const identifier = z.guid();
export const careRequestPayloadSchema = z.object({
  kind: careKindSchema, source: z.enum(['external_documented', 'professional_decision']),
  purpose: evidenceText, evidence: evidenceText,
  occurred_at: instant, next_review_at: instant, analytes: z.array(careAnalyteSchema).max(13),
}).strict().refine((value) => new Set(value.analytes).size === value.analytes.length
  && (value.kind === 'laboratory_order' ? value.analytes.length > 0 : value.analytes.length === 0),
  'Choose each requested analyte once; other follow-up types do not request analytes.');
export const careRequestReceiptSchema = z.object({
  request_id: identifier, work_item_id: identifier, event_id: identifier, workflow_revision: z.literal('1'),
  stage: z.literal('requested'), recorded_at: instant, acceptance_recorded: z.literal(false),
  external_transmission_confirmed: z.literal(false),
}).strict();
export const careRequestStateSchema = z.object({
  request_id: identifier, actor_id: identifier, organization_id: identifier, patient_id: identifier, work_item_id: identifier,
  payload: careRequestPayloadSchema, state: z.enum(['prepared', 'applied', 'cancelled']), recorded_at: instant,
  acknowledged_at: instant.nullable(), receipt: careRequestReceiptSchema.nullable(),
}).strict().refine((value) => value.state === 'applied'
  ? value.receipt?.request_id === value.request_id && value.receipt?.work_item_id === value.work_item_id
  : value.receipt === null && value.acknowledged_at === null);
export type CareRequestPayload = z.infer<typeof careRequestPayloadSchema>;
export type CareRequestState = z.infer<typeof careRequestStateSchema>;
