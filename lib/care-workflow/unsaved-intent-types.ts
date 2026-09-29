import { z } from 'zod';
import { careScopeSchema } from './types';
import { labCollectionMicros } from '@/lib/labs/quality';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const revision = (min = BigInt(1)) => z.string().refine((value) => /^(0|[1-9]\d{0,18})$/.test(value)
  && BigInt(value) >= min && BigInt(value) <= BigInt('9223372036854775807'));
const text = z.string().refine((value) => [...value].length <= 1000 && [...value.replace(/^ +| +$/g, '')].length >= 3);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const atOrAfter = (a: string, b: string) => (labCollectionMicros(a) ?? BigInt(-1)) >= (labCollectionMicros(b) ?? BigInt(0));
const sameInstant = (a: string, b: string) => labCollectionMicros(a) !== null && labCollectionMicros(a) === labCollectionMicros(b);
const ordered = (values: string[]) => values.every((value, n) => n === 0 || value > values[n - 1]);
export const unsavedSnapshotSchema = z.discriminatedUnion('submission_status', [
  z.object({ intent_id: guid, recorded_at: instant, submission_status: z.literal('awaiting_save'), submission_cancelled_at: z.null() }).strict(),
  z.object({ intent_id: guid, recorded_at: instant, submission_status: z.literal('submission_cancelled'), submission_cancelled_at: instant }).strict(),
]);
export const unsavedPayloadSchema = z.object({ snapshot: unsavedSnapshotSchema, occurred_at: instant,
  evidence: text, reason: text, unsaved_cancellation_acknowledged: z.literal(true),
}).strict().refine((value) => atOrAfter(value.occurred_at, value.snapshot.recorded_at)
  && (value.snapshot.submission_cancelled_at === null || atOrAfter(value.occurred_at, value.snapshot.submission_cancelled_at)));
const inputBase = careScopeSchema.extend({ request_id: guid, work_item_id: guid, intent_id: guid,
  expected_revision: revision(), expected_ownership_revision: revision(BigInt(0)), payload: unsavedPayloadSchema }).strict();
export const unsavedInputSchema = inputBase.refine((value) => same(value.intent_id, value.payload.snapshot.intent_id));
export const unsavedReceiptSchema = z.object({ request_id: guid, event_id: guid, work_item_id: guid, intent_id: guid,
  workflow_revision: revision(), ownership_revision: revision(BigInt(0)), recorded_at: instant,
  submission_cancelled_at: instant, intent_cancelled_at: instant, intention_cancelled: z.literal(true),
  result_saved: z.literal(false), result_linked: z.literal(false), clinical_review_recorded: z.literal(false),
  communication_confirmed: z.literal(false), care_completed: z.literal(false),
}).strict().refine((value) => atOrAfter(value.intent_cancelled_at, value.recorded_at)
  && atOrAfter(value.intent_cancelled_at, value.submission_cancelled_at));
function receiptMatches(payload: z.infer<typeof unsavedPayloadSchema>, receipt: z.infer<typeof unsavedReceiptSchema>) {
  return same(payload.snapshot.intent_id, receipt.intent_id) && atOrAfter(receipt.recorded_at, payload.occurred_at)
    && (payload.snapshot.submission_cancelled_at === null ? atOrAfter(receipt.submission_cancelled_at, receipt.recorded_at)
      : sameInstant(receipt.submission_cancelled_at, payload.snapshot.submission_cancelled_at));
}
export const unsavedStateSchema = inputBase.extend({ state: z.enum(['prepared', 'applied', 'cancelled']),
  recorded_at: instant, acknowledged_at: instant.nullable(), receipt: unsavedReceiptSchema.nullable(),
}).strict().refine((value) => same(value.intent_id, value.payload.snapshot.intent_id) && atOrAfter(value.recorded_at, value.payload.occurred_at)
  && (value.state === 'applied' ? value.receipt !== null && same(value.receipt.request_id, value.request_id)
    && same(value.receipt.work_item_id, value.work_item_id) && value.receipt.workflow_revision === value.expected_revision
    && value.receipt.ownership_revision === value.expected_ownership_revision && receiptMatches(value.payload, value.receipt)
    && atOrAfter(value.receipt.recorded_at, value.recorded_at)
    && (value.acknowledged_at === null || atOrAfter(value.acknowledged_at, value.receipt.intent_cancelled_at))
    : value.receipt === null && value.acknowledged_at === null));
export const unsavedContextSchema = careScopeSchema.extend({ work_item_id: guid, workflow_revision: revision(),
  ownership_revision: revision(BigInt(0)), snapshot: unsavedSnapshotSchema }).strict();
export const unsavedPendingPageSchema = z.object({ items: z.array(unsavedStateSchema).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.request_id.toLowerCase()))
    && value.items.every((row) => row.state !== 'cancelled' && row.acknowledged_at === null)
    && (value.next_cursor === null || value.items.length === 25 && same(value.next_cursor, value.items[24].request_id)));
const historyItem = z.object({ event_id: guid, actor_id: guid, intent_id: guid, recorded_at: instant,
  payload: unsavedPayloadSchema, receipt: unsavedReceiptSchema }).strict().refine((value) =>
  same(value.event_id, value.receipt.event_id) && same(value.intent_id, value.receipt.intent_id)
  && sameInstant(value.recorded_at, value.receipt.recorded_at) && receiptMatches(value.payload, value.receipt));
export const unsavedHistoryPageSchema = z.object({ work_item_id: guid, items: z.array(historyItem).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.event_id.toLowerCase()))
    && value.items.every((row) => same(row.receipt.work_item_id, value.work_item_id))
    && new Set(value.items.map((row) => row.intent_id.toLowerCase())).size === value.items.length
    && new Set(value.items.map((row) => row.receipt.request_id.toLowerCase())).size === value.items.length
    && (value.next_cursor === null || value.items.length === 25 && same(value.next_cursor, value.items[24].event_id)));

export type UnsavedInput = z.infer<typeof unsavedInputSchema>;
export type UnsavedState = z.infer<typeof unsavedStateSchema>;
export type UnsavedContext = z.infer<typeof unsavedContextSchema>;
export type UnsavedHistoryItem = z.infer<typeof historyItem>;
export function unsavedInputFromState(state: UnsavedState): UnsavedInput {
  const { actor_id, organization_id, patient_id, request_id, work_item_id, intent_id, expected_revision, expected_ownership_revision, payload } = state;
  return unsavedInputSchema.parse({ actor_id, organization_id, patient_id, request_id, work_item_id, intent_id, expected_revision, expected_ownership_revision, payload });
}
export function unsavedMatches(state: UnsavedState, input: UnsavedInput): boolean {
  const actual = unsavedInputFromState(state), expected = unsavedInputSchema.parse(input);
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'work_item_id', 'intent_id'] as const).every((key) => same(actual[key], expected[key]))
    && actual.expected_revision === expected.expected_revision && actual.expected_ownership_revision === expected.expected_ownership_revision
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
// Fresh validation must never replace decoding a historical private recovery response.
export function validateNewUnsavedInput(input: unknown, now = Date.now()): UnsavedInput | null {
  const parsed = unsavedInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const occurred = labCollectionMicros(parsed.data.payload.occurred_at);
  return occurred !== null && occurred <= BigInt(Math.trunc(now)) * BigInt(1000) ? parsed.data : null;
}
