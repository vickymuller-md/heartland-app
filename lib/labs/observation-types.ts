import { z } from 'zod';
import { careAnalyteSchema, careScopeSchema } from '@/lib/care-workflow/types';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
// Decode historical evidence without trimming, rounding decimals, changing time
// zones or applying new-operation freshness rules to a recovered request.
export const observationPayloadSchema = z.object({
  evidence: z.string().refine((value) => [...value].length <= 1000 && [...value.replace(/^ +| +$/g, '')].length >= 3),
  occurred_at: instant,
}).strict();
export const observationSourceSchema = z.object({
  value: z.string().regex(/^\d+(?:\.\d+)?$/), collected_at: instant,
}).strict();
export const observationInputSchema = careScopeSchema.extend({
  request_id: guid, root_id: guid, original_lab_result_id: guid, analyte: careAnalyteSchema,
  command: z.literal('register_source'), expected_revision: z.literal('0'), payload: observationPayloadSchema,
}).strict();
const receiptSchema = z.object({
  request_id: guid, root_id: guid, version_id: guid, revision: z.literal('1'),
  original_lab_result_id: guid, analyte: careAnalyteSchema, recorded_at: instant,
  source_authority_registered: z.literal(true), order_authorship_confirmed: z.literal(false),
  clinical_review_recorded: z.literal(false), care_completed: z.literal(false),
}).strict();
export const observationStateSchema = observationInputSchema.extend({
  source_snapshot: observationSourceSchema, state: z.enum(['prepared', 'applied', 'cancelled']),
  recorded_at: instant, acknowledged_at: instant.nullable(), receipt: receiptSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.state === 'applied') {
    const receipt = value.receipt;
    if (!receipt || !sameId(receipt.request_id, value.request_id) || !sameId(receipt.root_id, value.root_id)
      || !sameId(receipt.original_lab_result_id, value.original_lab_result_id) || receipt.analyte !== value.analyte) {
      ctx.addIssue({ code: 'custom', message: 'Observation receipt identity mismatch.' });
    }
  } else if (value.receipt !== null || value.acknowledged_at !== null) {
    ctx.addIssue({ code: 'custom', message: 'Unapplied registration cannot have a receipt or acknowledgement.' });
  }
});
export const observationPendingPageSchema = z.object({
  items: z.array(observationStateSchema).max(25), next_cursor: guid.nullable(),
}).strict().superRefine((value, ctx) => {
  const ids = value.items.map((item) => item.request_id.toLowerCase());
  if (value.items.some((item) => item.state === 'cancelled' || item.acknowledged_at !== null)
    || ids.some((id, index) => index > 0 && id <= ids[index - 1])
    || (value.next_cursor !== null && (value.items.length !== 25 || !sameId(value.next_cursor, ids[24])))) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete or inconsistent pending observation page.' });
  }
});
export type ObservationInput = z.infer<typeof observationInputSchema>;
export type ObservationState = z.infer<typeof observationStateSchema>;
export type ObservationPendingPage = z.infer<typeof observationPendingPageSchema>;
export function observationInputFromState(state: ObservationState): ObservationInput {
  const { actor_id, organization_id, patient_id, request_id, root_id, original_lab_result_id, analyte,
    command, expected_revision, payload } = state;
  return { actor_id, organization_id, patient_id, request_id, root_id, original_lab_result_id, analyte,
    command, expected_revision, payload: observationPayloadSchema.parse(payload) };
}
export function observationMatches(state: ObservationState, input: ObservationInput): boolean {
  const actual = observationInputFromState(state);
  const expected = observationInputSchema.parse(input);
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'root_id', 'original_lab_result_id'] as const)
    .every((key) => sameId(actual[key], expected[key]))
    && actual.analyte === expected.analyte && actual.command === expected.command && actual.expected_revision === expected.expected_revision
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
