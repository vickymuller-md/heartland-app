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

export const careScopeSchema = z.object({ actor_id: identifier, organization_id: identifier, patient_id: identifier }).strict();
export const careRequestInputSchema = careScopeSchema.extend({
  request_id: identifier, work_item_id: identifier, payload: careRequestPayloadSchema,
}).strict();
export const careRequestPageSchema = z.object({
  items: z.array(careRequestStateSchema).max(25), next_cursor: identifier.nullable(),
}).strict();
export type CareScope = z.infer<typeof careScopeSchema>;
export type CareRequestInput = z.infer<typeof careRequestInputSchema>;
export type CareRequestPage = z.infer<typeof careRequestPageSchema>;
export type CareRequestResult = { data: CareRequestState; error: null } | { data: null; error: string };
export const CARE_UNCONFIRMED = 'The request could not be confirmed. Check its saved state or retry with the same request ID. Do not create a replacement.';
export const CARE_READ_UNAVAILABLE = 'Pending requests could not be verified. New requests remain unavailable until the complete list can be loaded.';

export function careRequestMatches(saved: CareRequestState, expected: CareRequestInput): boolean {
  return saved.actor_id === expected.actor_id && saved.organization_id === expected.organization_id
    && saved.patient_id === expected.patient_id && saved.request_id === expected.request_id
    && saved.work_item_id === expected.work_item_id
    && (Object.keys(expected.payload) as (keyof CareRequestPayload)[]).every((key) =>
      JSON.stringify(saved.payload[key]) === JSON.stringify(expected.payload[key]));
}

/** Fresh form validation is separate from decoding a historical, possibly overdue receipt. */
export function validateNewCareRequest(payload: unknown, now = Date.now()): CareRequestPayload | null {
  const parsed = careRequestPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const value = parsed.data;
  if ([...value.purpose.replace(/^ +| +$/g, '')].length < 3
    || [...value.evidence.replace(/^ +| +$/g, '')].length < 3
    || Date.parse(value.occurred_at) > now || Date.parse(value.next_review_at) <= now) return null;
  return value;
}
