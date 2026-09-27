import { z } from 'zod';

const revision = z.string().regex(/^(0|[1-9]\d*)$/).max(19).refine(
  (value) => value.length <= 19 && /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= BigInt('9223372036854775807'),
);
export const reassignmentSchema = z.object({
  requestId: z.uuid(), workItemId: z.uuid(), patientId: z.uuid(),
  expectedAssignee: z.uuid(), expectedRevision: revision,
  assigneeId: z.uuid(), reason: z.string().trim().min(3).max(500),
}).strict();
export const reassignmentContextSchema = z.object({
  work_item_id: z.uuid(), patient_id: z.uuid(), current_assignee: z.uuid(),
  current_revision: revision, eligible: z.boolean(),
  targets: z.array(z.object({ id: z.uuid(), name: z.string() }).strict()).max(25),
  next_cursor: z.uuid().nullable(),
}).strict();
export const reassignmentReceiptSchema = z.object({
  request_id: z.uuid(), event_id: z.uuid(), work_item_id: z.uuid(), recorded_assignee: z.uuid(),
  recorded_revision: revision, recorded_at: z.iso.datetime({ offset: true }), acceptance_recorded: z.literal(false),
}).strict();
export type ReassignmentInput = z.infer<typeof reassignmentSchema>;
export type ReassignmentContext = z.infer<typeof reassignmentContextSchema>;
export type ReassignmentReceipt = z.infer<typeof reassignmentReceiptSchema>;
export function receiptMatches(receipt: ReassignmentReceipt, request: ReassignmentInput) {
  return receipt.request_id === request.requestId && receipt.work_item_id === request.workItemId
    && receipt.recorded_assignee === request.assigneeId
    && BigInt(receipt.recorded_revision) === BigInt(request.expectedRevision) + BigInt(1);
}
export function sameReassignment(a: ReassignmentInput, b: ReassignmentInput) {
  return (Object.keys(a) as (keyof ReassignmentInput)[]).every((key) => a[key] === b[key]);
}
export const reassignmentStateSchema = z.object({
  state: z.enum(['prepared', 'applied', 'seen', 'cancelled']), request: reassignmentSchema,
  receipt: reassignmentReceiptSchema.nullable(),
}).strict().refine((value) => value.state === 'applied' || value.state === 'seen'
  ? value.receipt !== null && receiptMatches(value.receipt, value.request)
  : value.receipt === null);
export const reassignmentPageSchema = z.object({
  items: z.array(reassignmentStateSchema.refine((value) => value.state === 'prepared' || value.state === 'applied')).max(25),
  inaccessible_count: z.number().int().nonnegative().safe(), next_cursor: z.uuid().nullable(),
}).strict();
export type ReassignmentState = z.infer<typeof reassignmentStateSchema>;
export type ReassignmentPage = z.infer<typeof reassignmentPageSchema>;
export type ReassignmentResult = { success: true; receipt: ReassignmentReceipt; recovery: ReassignmentState; error?: never }
  | { success: false; error: string; status: 'unknown' | 'rejected'; recovery?: ReassignmentState };
export const REASSIGNMENT_UNKNOWN = 'Confirmation is unavailable. Retry this same request to recover its recorded result; do not create a second transfer.';
export const REASSIGNMENT_UNAVAILABLE = 'Current ownership and eligible recipients are unavailable. Check your access and try again.';
