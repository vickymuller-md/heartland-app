import { z } from 'zod';
import { careAnalyteSchema, careScopeSchema } from './types';
import { labCollectionMicros } from '@/lib/labs/quality';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const integer = (value: string) => /^(0|[1-9]\d{0,18})$/.test(value) ? BigInt(value) : null;
const revision = (min = BigInt(1), max = BigInt('9223372036854775807')) => z.string().refine((value) => {
  const n = integer(value); return n !== null && n >= min && n <= max;
});
const expectedRevision = revision(BigInt(0), BigInt('9223372036854775806'));
const text = z.string().refine((value) => [...value].length <= 1000 && [...value.replace(/^ +| +$/g, '')].length >= 3);
const same = (a: string | null, b: string | null) => a?.toLowerCase() === b?.toLowerCase();
const after = (a: string, b: string) => (labCollectionMicros(a) ?? BigInt(-1)) >= (labCollectionMicros(b) ?? BigInt(0));
const equalTime = (a: string, b: string) => labCollectionMicros(a) !== null && labCollectionMicros(a) === labCollectionMicros(b);
const next = (a: string, b: string) => integer(a) !== null && integer(b) !== null && integer(b) === integer(a)! + BigInt(1);
const ordered = (values: string[]) => values.every((value, n) => n === 0 || value.toLowerCase() > values[n - 1].toLowerCase());
const uuidPage = (ids: string[], cursor: string | null) => ordered(ids)
  && (cursor === null || ids.length === 25 && same(cursor, ids[24]));

export const postclosureSnapshotSchema = z.object({
  invalidation_id: guid, organization_id: guid, patient_id: guid, predecessor_work_item_id: guid,
  closure_event_id: guid, closure_recorded_at: instant, entry_id: guid, composition_event_id: guid,
  analyte: careAnalyteSchema, root_id: guid, change_version_id: guid, change_revision: revision(BigInt(2)),
  change_status: z.enum(['corrected', 'cancelled']), change_recorded_at: instant, invalidation_recorded_at: instant,
}).strict().refine((value) => after(value.invalidation_recorded_at, value.change_recorded_at));
// The ALL-known baseline, not a timestamp comparison with closure, defines this origin.
export const postclosurePayloadSchema = z.object({ snapshot: postclosureSnapshotSchema, occurred_at: instant,
  evidence: text, reason: text, review_at: instant, responsibility_acknowledged: z.literal(true),
  supersession_acknowledged: z.boolean(),
}).strict().refine((value) => after(value.occurred_at, value.snapshot.invalidation_recorded_at)
  && after(value.review_at, value.occurred_at) && !equalTime(value.review_at, value.occurred_at));
const inputBase = careScopeSchema.extend({ request_id: guid, invalidation_id: guid, predecessor_work_item_id: guid,
  work_item_id: guid, expected_revision: z.literal('1'), expected_ownership_revision: revision(BigInt(0)),
  expected_routing_revision: expectedRevision, previous_event_id: guid.nullable(), payload: postclosurePayloadSchema }).strict();
type BaseInput = z.infer<typeof inputBase>;
function inputRelations(value: BaseInput) {
  const s = value.payload.snapshot;
  return same(s.organization_id, value.organization_id) && same(s.patient_id, value.patient_id)
    && same(s.invalidation_id, value.invalidation_id) && same(s.predecessor_work_item_id, value.predecessor_work_item_id)
    && !same(value.work_item_id, value.predecessor_work_item_id)
    && (value.expected_routing_revision === '0') === (value.previous_event_id === null)
    && value.payload.supersession_acknowledged === (value.expected_routing_revision !== '0');
}
export const postclosureInputSchema = inputBase.refine(inputRelations);
export const postclosureReceiptSchema = z.object({ request_id: guid, event_id: guid, invalidation_id: guid,
  predecessor_work_item_id: guid, work_item_id: guid, previous_event_id: guid.nullable(),
  routing_revision: revision(), workflow_revision: z.literal('1'), ownership_revision: revision(BigInt(0)),
  recorded_at: instant, review_at: instant, delegated: z.literal(true), clinical_invalidation_resolved: z.literal(false),
  clinical_review_recorded: z.literal(false), communication_confirmed: z.literal(false), care_completed: z.literal(false),
}).strict().refine((value) => !same(value.work_item_id, value.predecessor_work_item_id)
  && (value.routing_revision === '1') === (value.previous_event_id === null)
  && !same(value.event_id, value.previous_event_id)
  && after(value.review_at, value.recorded_at) && !equalTime(value.review_at, value.recorded_at));
function receiptPayload(payload: z.infer<typeof postclosurePayloadSchema>, receipt: z.infer<typeof postclosureReceiptSchema>) {
  return same(payload.snapshot.invalidation_id, receipt.invalidation_id)
    && same(payload.snapshot.predecessor_work_item_id, receipt.predecessor_work_item_id)
    && after(receipt.recorded_at, payload.occurred_at) && equalTime(payload.review_at, receipt.review_at)
    && payload.supersession_acknowledged === (receipt.routing_revision !== '1');
}
export const postclosureStateSchema = inputBase.extend({ state: z.enum(['prepared', 'applied', 'cancelled']),
  recorded_at: instant, acknowledged_at: instant.nullable(), receipt: postclosureReceiptSchema.nullable(),
}).strict().refine((value) => {
  if (!inputRelations(value) || !after(value.recorded_at, value.payload.occurred_at)
    || !after(value.payload.review_at, value.recorded_at) || equalTime(value.payload.review_at, value.recorded_at)) return false;
  if (value.state !== 'applied') return value.receipt === null && value.acknowledged_at === null;
  const r = value.receipt;
  return r !== null && same(r.request_id, value.request_id) && same(r.work_item_id, value.work_item_id)
    && same(r.previous_event_id, value.previous_event_id) && next(value.expected_routing_revision, r.routing_revision)
    && r.workflow_revision === value.expected_revision && r.ownership_revision === value.expected_ownership_revision
    && receiptPayload(value.payload, r) && after(r.recorded_at, value.recorded_at)
    && (value.acknowledged_at === null || after(value.acknowledged_at, r.recorded_at));
});
export const postclosureContextSchema = careScopeSchema.extend({ work_item_id: guid, workflow_revision: z.literal('1'),
  ownership_revision: revision(BigInt(0)), routing_revision: expectedRevision, previous_event_id: guid.nullable(),
  previous_work_item_id: guid.nullable(), successor_created_at: instant, successor_accepted_at: instant,
  review_at: instant, snapshot: postclosureSnapshotSchema,
}).strict().refine((value) => same(value.organization_id, value.snapshot.organization_id)
  && same(value.patient_id, value.snapshot.patient_id) && !same(value.work_item_id, value.snapshot.predecessor_work_item_id)
  && !same(value.work_item_id, value.previous_work_item_id)
  && (value.routing_revision === '0') === (value.previous_event_id === null)
  && (value.previous_event_id === null) === (value.previous_work_item_id === null)
  && !same(value.previous_work_item_id, value.snapshot.predecessor_work_item_id)
  && after(value.successor_created_at, value.snapshot.invalidation_recorded_at)
  && after(value.review_at, value.successor_created_at) && !equalTime(value.review_at, value.successor_created_at)
  && after(value.review_at, value.successor_accepted_at) && !equalTime(value.review_at, value.successor_accepted_at));
// Ownership's accepted_at is transaction-start time in the existing API; do not require it after server creation.
export const postclosurePendingPageSchema = z.object({ items: z.array(postclosureStateSchema).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => uuidPage(value.items.map((row) => row.request_id), value.next_cursor)
    && value.items.every((row) => row.state !== 'cancelled' && row.acknowledged_at === null));
const historyItem = z.object({ event_id: guid, actor_id: guid, payload: postclosurePayloadSchema, receipt: postclosureReceiptSchema }).strict()
  .refine((value) => same(value.event_id, value.receipt.event_id) && receiptPayload(value.payload, value.receipt));
export const postclosureHistoryPageSchema = z.object({ invalidation_id: guid, items: z.array(historyItem).max(25), next_cursor: revision().nullable() }).strict()
  .refine((value) => value.items.every((row, n) => same(row.receipt.invalidation_id, value.invalidation_id)
    && JSON.stringify(row.payload.snapshot) === JSON.stringify(value.items[0].payload.snapshot)
    && (n === 0 || next(value.items[n - 1].receipt.routing_revision, row.receipt.routing_revision)
      && same(row.receipt.previous_event_id, value.items[n - 1].event_id)
      && !same(row.receipt.work_item_id, value.items[n - 1].receipt.work_item_id)
      && after(row.receipt.recorded_at, value.items[n - 1].receipt.recorded_at)))
    && new Set(value.items.map((row) => row.event_id.toLowerCase())).size === value.items.length
    && new Set(value.items.map((row) => row.receipt.request_id.toLowerCase())).size === value.items.length
    && (value.next_cursor === null || value.items.length === 25 && value.next_cursor === value.items[24].receipt.routing_revision));
const currentRoute = z.object({ event_id: guid, routing_revision: revision(), work_item_id: guid, recorded_at: instant,
  assigned_to: guid.nullable(), accepted_by: guid.nullable(), accepted_at: instant.nullable(), transfer_pending_to: guid.nullable(),
  work_status: z.enum(['new', 'reviewed', 'actioned', 'awaiting', 'due', 'closed']), current_due_at: instant,
}).strict();
export const postclosureNeedSchema = z.object({ invalidation_id: guid, patient_id: guid, predecessor_work_item_id: guid,
  recorded_at: instant, snapshot: postclosureSnapshotSchema, current_route: currentRoute.nullable(),
  routing_state: z.enum(['unrouted', 'delegated', 'overdue', 'responsibility_unavailable', 'successor_closed']),
}).strict().refine((value) => same(value.invalidation_id, value.snapshot.invalidation_id)
  && same(value.patient_id, value.snapshot.patient_id) && same(value.predecessor_work_item_id, value.snapshot.predecessor_work_item_id)
  && equalTime(value.recorded_at, value.snapshot.invalidation_recorded_at)
  && (value.current_route === null ? value.routing_state === 'unrouted'
    : value.routing_state !== 'unrouted' && !same(value.current_route.work_item_id, value.predecessor_work_item_id)
      && after(value.current_route.recorded_at, value.recorded_at)
      && (!['delegated', 'overdue'].includes(value.routing_state) || value.current_route.assigned_to !== null
        && value.current_route.accepted_at !== null && same(value.current_route.accepted_by, value.current_route.assigned_to))
      && (value.routing_state === 'successor_closed') === (value.current_route.work_status === 'closed')));
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const counts = z.object({ unrouted: count, delegated: count, overdue: count, responsibility_unavailable: count, successor_closed: count }).strict();
export const postclosureNeedsPageSchema = z.object({ organization_id: guid, items: z.array(postclosureNeedSchema).max(25),
  next_cursor: guid.nullable(), counts: counts.nullable(),
}).strict().refine((value) => uuidPage(value.items.map((row) => row.invalidation_id), value.next_cursor)
  && value.items.every((row) => same(row.snapshot.organization_id, value.organization_id)));
const successor = z.object({ work_item_id: guid, created_at: instant, accepted_at: instant,
  ownership_revision: revision(BigInt(0)), workflow_revision: z.literal('1'), review_at: instant }).strict()
  .refine((value) => after(value.review_at, value.created_at) && !equalTime(value.review_at, value.created_at)
    && after(value.review_at, value.accepted_at) && !equalTime(value.review_at, value.accepted_at));
export const postclosureSuccessorsPageSchema = z.object({ invalidation_id: guid, items: z.array(successor).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => uuidPage(value.items.map((row) => row.work_item_id), value.next_cursor));
export const postclosureHistoryCursorSchema = revision(BigInt(0)).nullable();
export type PostclosureInput = z.infer<typeof postclosureInputSchema>;
export type PostclosureState = z.infer<typeof postclosureStateSchema>;
export type PostclosureContext = z.infer<typeof postclosureContextSchema>;
export type PostclosureNeed = z.infer<typeof postclosureNeedSchema>;
export type PostclosureHistoryItem = z.infer<typeof historyItem>;
// Filtering occurs only after validating the raw page; its cursor does not refer to the final filtered row.
export type PostclosurePatientPage = { organization_id: string; patient_id: string; items: PostclosureNeed[];
  next_cursor: string | null; organization_counts: z.infer<typeof counts> | null };
export function postclosureInputFromState(value: PostclosureState): PostclosureInput {
  const { actor_id, organization_id, patient_id, request_id, invalidation_id, predecessor_work_item_id, work_item_id,
    expected_revision, expected_ownership_revision, expected_routing_revision, previous_event_id, payload } = value;
  return postclosureInputSchema.parse({ actor_id, organization_id, patient_id, request_id, invalidation_id,
    predecessor_work_item_id, work_item_id, expected_revision, expected_ownership_revision, expected_routing_revision, previous_event_id, payload });
}
export function postclosureMatches(value: PostclosureState, input: PostclosureInput): boolean {
  const actual = postclosureInputFromState(value), expected = postclosureInputSchema.parse(input);
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'invalidation_id', 'predecessor_work_item_id', 'work_item_id', 'previous_event_id'] as const)
    .every((key) => same(actual[key], expected[key]))
    && actual.expected_revision === expected.expected_revision && actual.expected_ownership_revision === expected.expected_ownership_revision
    && actual.expected_routing_revision === expected.expected_routing_revision && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
export function validateNewPostclosure(input: unknown, now = Date.now()): PostclosureInput | null {
  const parsed = postclosureInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const at = BigInt(Math.trunc(now)) * BigInt(1000);
  return (labCollectionMicros(parsed.data.payload.occurred_at) ?? at + BigInt(1)) <= at
    && (labCollectionMicros(parsed.data.payload.review_at) ?? at) > at ? parsed.data : null;
}
