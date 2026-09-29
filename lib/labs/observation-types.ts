import { z } from 'zod';
import { careAnalyteSchema, careScopeSchema } from '@/lib/care-workflow/types';
import { labCollectionMicros } from './quality';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const text = z.string().refine((value) => [...value].length <= 1000 && [...value.replace(/^ +| +$/g, '')].length >= 3);
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/);
const revision = (min: bigint, max = BigInt('9223372036854775807')) => z.string().refine((value) =>
  /^[1-9]\d{0,18}$/.test(value) && BigInt(value) >= min && BigInt(value) <= max);
const sameDecimal = (a: string, b: string) => {
  const normalize = (value: string) => value.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return normalize(a) === normalize(b);
};
// Receipt decoding preserves frozen text, decimal spelling and microseconds; it is not fresh-operation validation.
export const observationPayloadSchema = z.object({ evidence: text, occurred_at: instant }).strict();
export const observationChangePayloadSchema = observationPayloadSchema.extend({ reason: text }).strict();
export const observationCorrectionPayloadSchema = observationChangePayloadSchema.extend({
  value: decimal.max(256), collected_at: instant,
}).strict();
export const observationSourceSchema = z.object({ value: decimal, collected_at: instant }).strict();
const headSchema = z.object({
  version_id: guid, revision: revision(BigInt(1)), status: z.enum(['original', 'corrected', 'cancelled']),
  effective_lab_result_id: guid.nullable(), value: decimal.nullable(), collected_at: instant,
}).strict().refine((value) => (value.status === 'original') === (value.revision === '1')
  && (value.status === 'cancelled') === (value.value === null)
  && (value.status === 'cancelled') === (value.effective_lab_result_id === null));
export const observationHeadSchema = headSchema;
const identity = careScopeSchema.extend({ request_id: guid, root_id: guid, original_lab_result_id: guid, analyte: careAnalyteSchema }).strict();
const registrationInput = identity.extend({
  command: z.literal('register_source'), expected_revision: z.literal('0'), payload: observationPayloadSchema,
}).strict();
const correctionInput = identity.extend({
  command: z.literal('correct_source'), expected_revision: revision(BigInt(1), BigInt('9223372036854775806')),
  payload: observationCorrectionPayloadSchema,
}).strict();
const cancellationInput = identity.extend({
  command: z.literal('cancel_source'), expected_revision: revision(BigInt(1), BigInt('9223372036854775806')),
  payload: observationChangePayloadSchema,
}).strict();
export const observationInputSchema = z.discriminatedUnion('command', [registrationInput, correctionInput, cancellationInput]);
const receiptIdentity = z.object({
  request_id: guid, root_id: guid, version_id: guid, original_lab_result_id: guid, analyte: careAnalyteSchema,
  recorded_at: instant, order_authorship_confirmed: z.literal(false),
  clinical_review_recorded: z.literal(false), care_completed: z.literal(false),
}).strict();
const registrationReceipt = receiptIdentity.extend({
  revision: z.literal('1'), source_authority_registered: z.literal(true),
}).strict();
const changeReceipt = receiptIdentity.extend({
  revision: revision(BigInt(2)), previous_version_id: guid, status: z.enum(['corrected', 'cancelled']),
  effective_lab_result_id: guid.nullable(), stored_source: z.object({ value: decimal.nullable(), collected_at: instant }).strict(),
  evaluation_status: z.literal('pending').nullable(), source_change_recorded: z.literal(true),
  // Older receipts remain false; true records fan-out, never human review.
  work_invalidation_recorded: z.boolean(),
}).strict().refine((value) => (value.status === 'cancelled') === (value.effective_lab_result_id === null)
  && (value.status === 'cancelled') === (value.stored_source.value === null)
  && (value.status === 'cancelled') === (value.evaluation_status === null));
const stateFields = { state: z.enum(['prepared', 'applied', 'cancelled']), recorded_at: instant, acknowledged_at: instant.nullable() };
export const observationStateSchema = z.discriminatedUnion('command', [
  registrationInput.extend({ ...stateFields, source_snapshot: observationSourceSchema, receipt: registrationReceipt.nullable() }).strict(),
  correctionInput.extend({ ...stateFields, source_snapshot: headSchema, receipt: changeReceipt.nullable() }).strict(),
  cancellationInput.extend({ ...stateFields, source_snapshot: headSchema, receipt: changeReceipt.nullable() }).strict(),
]).superRefine((value, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Observation source or receipt identity mismatch.' });
  if (value.command !== 'register_source') {
    const head = value.source_snapshot;
    if (head.revision !== value.expected_revision || (head.status === 'original' && (head.effective_lab_result_id === null || !sameId(head.effective_lab_result_id, value.original_lab_result_id)))
      || (head.status === 'corrected' && head.effective_lab_result_id !== null && sameId(head.effective_lab_result_id, value.original_lab_result_id))
      || (value.command === 'cancel_source' && head.status === 'cancelled')) invalid();
  }
  if (value.state === 'applied') {
    const receipt = value.receipt;
    if (!receipt || !sameId(receipt.request_id, value.request_id) || !sameId(receipt.root_id, value.root_id)
      || !sameId(receipt.original_lab_result_id, value.original_lab_result_id) || receipt.analyte !== value.analyte) { invalid(); return; }
    if (value.command !== 'register_source') {
      const changed = value.receipt!;
      const head = value.source_snapshot;
      if (!/^[1-9]\d{0,18}$/.test(changed.revision) || !/^[1-9]\d{0,18}$/.test(value.expected_revision)
        || BigInt(changed.revision) !== BigInt(value.expected_revision) + BigInt(1)
        || !sameId(changed.previous_version_id, head.version_id) || sameId(changed.version_id, head.version_id)
        || changed.status !== (value.command === 'correct_source' ? 'corrected' : 'cancelled')) invalid();
      if (value.command === 'correct_source') {
        if (changed.stored_source.value === null || !sameDecimal(changed.stored_source.value, value.payload.value)
          || labCollectionMicros(changed.stored_source.collected_at) !== labCollectionMicros(value.payload.collected_at)
          || changed.effective_lab_result_id === null || sameId(changed.effective_lab_result_id, value.original_lab_result_id)
          || (head.effective_lab_result_id !== null && sameId(changed.effective_lab_result_id, head.effective_lab_result_id))) invalid();
      } else if (labCollectionMicros(changed.stored_source.collected_at) !== labCollectionMicros(head.collected_at)) invalid();
    }
  } else if (value.receipt !== null || value.acknowledged_at !== null) invalid();
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
  return observationInputSchema.parse({ actor_id, organization_id, patient_id, request_id, root_id, original_lab_result_id, analyte,
    command, expected_revision, payload });
}
export function observationMatches(state: ObservationState, input: ObservationInput): boolean {
  const actual = observationInputFromState(state);
  const expected = observationInputSchema.parse(input);
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'root_id', 'original_lab_result_id'] as const)
    .every((key) => sameId(actual[key], expected[key]))
    && actual.analyte === expected.analyte && actual.command === expected.command && actual.expected_revision === expected.expected_revision
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
