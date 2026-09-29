import { z } from 'zod';
import { careAnalyteSchema, careScopeSchema } from './types';
import { observationHeadSchema } from '@/lib/labs/observation-types';
import { labEvaluationStatusSchema } from '@/lib/labs/evaluation';
import { labCollectionMicros } from '@/lib/labs/quality';
import { submissionIntentAnalyteSchema, submissionIntentSubmissionSchema } from './submission-intent-types';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const validRevision = (value: string, minimum = BigInt(1), maximum = BigInt('9223372036854775807')) =>
  /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) >= minimum && BigInt(value) <= maximum;
const revision = (min = BigInt(1), max = BigInt('9223372036854775807')) => z.string().refine((value) => validRevision(value, min, max));
const evidence = (max = 1000) => z.string().refine((value) => [...value].length <= max && [...value.replace(/^ +| +$/g, '')].length >= 3);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const ordered = (values: string[]) => values.every((value, n) => n === 0 || value > values[n - 1]);
const intentAnalytes = z.array(submissionIntentAnalyteSchema).max(4).refine((values) => new Set(values).size === values.length);
const stages = z.enum(['requested', 'scheduled', 'collected', 'result_received']);
const noCare = { clinical_review_recorded: z.literal(false), communication_confirmed: z.literal(false), care_completed: z.literal(false) };
const source = z.object({ analyte: careAnalyteSchema, root_id: guid.nullable(), expected_root_revision: revision().nullable() }).strict()
  .refine((value) => (value.root_id === null) === (value.expected_root_revision === null));
const resolutionInput = z.object({ intent_id: guid, disposition: z.enum(['linked', 'not_used']), reason: evidence() }).strict();
export const compositionPayloadSchema = z.object({ occurred_at: instant, evidence: evidence(), reason: evidence(), next_action: evidence(500),
  next_review_at: instant, sources: z.array(source).min(1).max(13), intent_resolutions: z.array(resolutionInput).max(25),
}).strict().refine((value) => ordered(value.sources.map((row) => row.analyte))
  && ordered(value.intent_resolutions.map((row) => row.intent_id.toLowerCase())));
export const compositionInputSchema = careScopeSchema.extend({ request_id: guid, work_item_id: guid,
  expected_revision: revision(BigInt(1), BigInt('9223372036854775806')), expected_ownership_revision: revision(BigInt(0)),
  payload: compositionPayloadSchema }).strict();
const receiptSource = z.object({ analyte: careAnalyteSchema, root_id: guid.nullable(), observed_head: observationHeadSchema.nullable() }).strict()
  .refine((value) => (value.root_id === null) === (value.observed_head === null));
const resolution = resolutionInput.extend({ lab_result_id: guid, matched_analytes: intentAnalytes, missing_analytes: intentAnalytes }).strict()
  .refine((value) => (value.disposition === 'linked' ? value.matched_analytes.length > 0 : value.matched_analytes.length === 0)
    && !value.matched_analytes.some((key) => value.missing_analytes.includes(key)));
export const compositionReceiptSchema = z.object({ request_id: guid, work_item_id: guid, event_id: guid, previous_event_id: guid.nullable(),
  workflow_revision: revision(BigInt(2)), ownership_revision: revision(BigInt(0)), stage: stages, recorded_at: instant, due_at: instant,
  sources: z.array(receiptSource).min(1).max(13), intent_resolutions: z.array(resolution).max(25), ...noCare,
}).strict().refine((value) => ordered(value.sources.map((row) => row.analyte))
  && ordered(value.intent_resolutions.map((row) => row.intent_id.toLowerCase()))
  && (value.sources.every((row) => row.root_id === null) || value.stage === 'result_received')
  && (value.previous_event_id !== null || value.sources.some((row) => row.root_id !== null)
    || value.intent_resolutions.some((row) => row.disposition === 'not_used'))
  && value.intent_resolutions.every((row) => row.matched_analytes.every((key) => value.sources.some((entry) => entry.analyte === key && entry.root_id !== null)))
  && (value.previous_event_id === null || !same(value.previous_event_id, value.event_id)));
function receiptMatches(payload: z.infer<typeof compositionPayloadSchema>, receipt: z.infer<typeof compositionReceiptSchema>) {
  return receipt.sources.length === payload.sources.length && receipt.sources.every((row, n) => {
    const expected = payload.sources[n];
    return row.analyte === expected.analyte && (row.root_id === null ? expected.root_id === null
      : expected.root_id !== null && same(row.root_id, expected.root_id) && row.observed_head?.revision === expected.expected_root_revision);
  }) && receipt.intent_resolutions.length === payload.intent_resolutions.length && receipt.intent_resolutions.every((row, n) => {
    const expected = payload.intent_resolutions[n];
    return same(row.intent_id, expected.intent_id) && row.disposition === expected.disposition && row.reason === expected.reason
      && [...row.matched_analytes, ...row.missing_analytes].every((key) => payload.sources.some((entry) => entry.analyte === key));
  });
}
export const compositionStateSchema = compositionInputSchema.extend({ state: z.enum(['prepared', 'applied', 'cancelled']),
  recorded_at: instant, acknowledged_at: instant.nullable(), receipt: compositionReceiptSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const receipt = value.receipt;
  if (value.state === 'applied' ? !receipt || !same(receipt.request_id, value.request_id) || !same(receipt.work_item_id, value.work_item_id)
    || !validRevision(value.expected_revision) || !validRevision(receipt.workflow_revision)
    || BigInt(receipt.workflow_revision) !== BigInt(value.expected_revision) + BigInt(1)
    || receipt.ownership_revision !== value.expected_ownership_revision || !receiptMatches(value.payload, receipt)
    : receipt !== null || value.acknowledged_at !== null) ctx.addIssue({ code: 'custom', message: 'Composition receipt disagrees with its frozen request.' });
});
export const compositionPendingPageSchema = z.object({ items: z.array(compositionStateSchema).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.request_id.toLowerCase()))
    && value.items.every((row) => row.state !== 'cancelled' && row.acknowledged_at === null)
    && (value.next_cursor === null || (value.items.length === 25 && same(value.next_cursor, value.items[24].request_id))));

// A detail can expose an invalid legacy value as text without treating it as usable.
const detailHead = z.object({ version_id: guid, revision: revision(), status: z.enum(['original', 'corrected', 'cancelled']),
  effective_lab_result_id: guid.nullable(), value: z.string().nullable(), collected_at: instant,
}).strict().refine((value) => (value.status === 'cancelled') === (value.effective_lab_result_id === null)
  && (value.status === 'cancelled') === (value.value === null) && (value.status === 'original') === (value.revision === '1'));
const detailSource = z.object({ analyte: careAnalyteSchema, entry_id: guid.nullable(), root_id: guid.nullable(),
  authority_organization_id: guid.nullable(), original_lab_result_id: guid.nullable(), observed_version_id: guid.nullable(),
  head: detailHead.nullable(), evaluation_status: labEvaluationStatusSchema.nullable(), quality: z.enum(['missing', 'available', 'cancelled', 'invalid']),
}).strict().superRefine((value, ctx) => {
  const missing = value.quality === 'missing'; const head = value.head;
  if (missing ? value.root_id !== null || value.authority_organization_id !== null || value.original_lab_result_id !== null
    || value.observed_version_id !== null || head !== null || value.evaluation_status !== null
    : value.entry_id === null || value.root_id === null || value.authority_organization_id === null || value.original_lab_result_id === null
      || value.observed_version_id === null || head === null || (value.quality === 'cancelled') !== (head.status === 'cancelled')
      || (head.status === 'cancelled' && value.evaluation_status !== null)
      || (head.status === 'original' && head.effective_lab_result_id !== null && !same(head.effective_lab_result_id, value.original_lab_result_id))
      || (head.status === 'corrected' && head.effective_lab_result_id !== null && same(head.effective_lab_result_id, value.original_lab_result_id))
      || (value.quality === 'available' && (head.value === null || !/^\d+(\.\d+)?$/.test(head.value)))) {
    ctx.addIssue({ code: 'custom', message: 'Source quality and provenance disagree.' });
  }
});
export const compositionDetailSchema = careScopeSchema.extend({ work_item_id: guid, workflow_revision: revision(),
  ownership_revision: revision(BigInt(0)), stage: stages, composition_event_id: guid.nullable(), sources: z.array(detailSource).min(1).max(13),
  pending_intent_count: revision(BigInt(0)), invalidation_count: revision(BigInt(0)), ...noCare,
}).strict().refine((value) => ordered(value.sources.map((row) => row.analyte))
  && value.sources.every((row) => (value.composition_event_id === null) === (row.entry_id === null)));
const historyItem = z.object({ payload: compositionPayloadSchema, receipt: compositionReceiptSchema }).strict()
  .refine((value) => receiptMatches(value.payload, value.receipt));
export const compositionHistorySchema = z.object({ work_item_id: guid, items: z.array(historyItem).max(25), next_cursor: revision(BigInt(2)).nullable() }).strict()
  .refine((value) => value.items.every((row, n) => same(row.receipt.work_item_id, value.work_item_id)
    && validRevision(row.receipt.workflow_revision) && (n === 0 || validRevision(value.items[n - 1].receipt.workflow_revision)
      && BigInt(row.receipt.workflow_revision) > BigInt(value.items[n - 1].receipt.workflow_revision)))
    && (value.next_cursor === null || value.items.length === 25 && value.next_cursor === value.items[24].receipt.workflow_revision));
const routingItem = z.object({ intent_id: guid, recorded_at: instant, intended_analytes: z.array(submissionIntentAnalyteSchema).min(1).max(4),
  submission: submissionIntentSubmissionSchema }).strict().refine((value) => value.submission.status !== 'saved_reconciled'
    && new Set(value.intended_analytes).size === value.intended_analytes.length
    && JSON.stringify(value.submission.missing_analytes) === JSON.stringify(value.intended_analytes.filter((key) => !value.submission.recorded_analytes.includes(key))));
export const compositionRoutingPageSchema = z.object({ work_item_id: guid, items: z.array(routingItem).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.intent_id.toLowerCase()))
    && (value.next_cursor === null || value.items.length === 25 && same(value.next_cursor, value.items[24].intent_id)));
const invalidationItem = z.object({ id: guid, entry_id: guid, change_version_id: guid, recorded_at: instant, analyte: careAnalyteSchema,
  root_id: guid, event_id: guid }).strict();
export const compositionInvalidationPageSchema = z.object({ work_item_id: guid, items: z.array(invalidationItem).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.id.toLowerCase()))
    && (value.next_cursor === null || value.items.length === 25 && same(value.next_cursor, value.items[24].id)));
export type CompositionInput = z.infer<typeof compositionInputSchema>;
export type CompositionState = z.infer<typeof compositionStateSchema>;
export type CompositionDetail = z.infer<typeof compositionDetailSchema>;
export function compositionInputFromState(state: CompositionState): CompositionInput {
  const { actor_id, organization_id, patient_id, request_id, work_item_id, expected_revision, expected_ownership_revision, payload } = state;
  return compositionInputSchema.parse({ actor_id, organization_id, patient_id, request_id, work_item_id, expected_revision, expected_ownership_revision, payload });
}
export function compositionMatches(state: CompositionState, input: CompositionInput): boolean {
  const actual = compositionInputFromState(state); const expected = compositionInputSchema.parse(input);
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'work_item_id'] as const).every((key) => same(actual[key], expected[key]))
    && actual.expected_revision === expected.expected_revision && actual.expected_ownership_revision === expected.expected_ownership_revision
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
export function validateNewComposition(input: unknown, now = Date.now()): CompositionInput | null {
  const parsed = compositionInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const occurred = labCollectionMicros(parsed.data.payload.occurred_at); const next = labCollectionMicros(parsed.data.payload.next_review_at);
  const current = BigInt(Math.trunc(now)) * BigInt(1000);
  return occurred !== null && next !== null && occurred <= current && next > current ? parsed.data : null;
}
