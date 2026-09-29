import { z } from 'zod';
import { careKindSchema, careScopeSchema } from './types';
import { careStepCommandSchema, careStepStageSchema, careExceptionCodeSchema } from './step-command';
import { compositionDetailSchema, sourceInvalidationSnapshotSchema, sourceResolutionDispositionSchema } from './composition-types';
import { labEvaluationStatusSchema, labSourceAssessmentSchema, labEvaluationHistorySchema } from '@/lib/labs/evaluation';
import { labCollectionMicros } from '@/lib/labs/quality';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const validRevision = (value: string, min = BigInt(1), max = BigInt('9223372036854775807')) =>
  /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) >= min && BigInt(value) <= max;
const revision = (min = BigInt(1), max = BigInt('9223372036854775807')) => z.string().refine((value) => validRevision(value, min, max));
const text = (max = 1000) => z.string().refine((value) => [...value].length <= max && [...value.replace(/^ +| +$/g, '')].length >= 3);
const signature = z.string().regex(/^[0-9a-f]{64}$/);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const ordered = (values: string[]) => values.every((value, n) => n === 0 || value > values[n - 1]);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value, n) => value === b[n]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const common = { occurred_at: instant, evidence: text(), next_action: text(500), next_review_at: instant };
export const exceptionSnapshotSchema = z.object({ exception_id: guid, origin_event_id: guid.nullable(), human_origin_event_id: guid.nullable(),
  origin_revision: revision(BigInt(2)), origin_occurred_at: instant, code: z.enum([...careExceptionCodeSchema.options, 'assistance_denied']),
  reason: text(), next_action: text(500), next_review_at: instant, recorded_at: instant,
}).strict().refine((value) => (value.origin_event_id === null) !== (value.human_origin_event_id === null));
const resolutionPayload = z.object({ ...common, details: z.object({ exception: exceptionSnapshotSchema,
  disposition: z.enum(['barrier_addressed', 'clinical_non_delivery']), resolution_reason: text(),
}).strict() }).strict().refine((value) => (labCollectionMicros(value.occurred_at) ?? BigInt(-1))
  >= (labCollectionMicros(value.details.exception.origin_occurred_at) ?? BigInt(0)));
const reviewPayload = z.object({ ...common, details: z.object({ decision: text(), limitations: text() }).strict() }).strict();
const sourceResolutionPayload = z.object({ ...common, details: z.object({ invalidation: sourceInvalidationSnapshotSchema,
  review_event_id: guid, contact_event_id: guid, disposition: sourceResolutionDispositionSchema, resolution_reason: text(),
  source_reviewed: z.literal(true), change_addressed_in_contact: z.literal(true), source_review_evidence: text(), source_communication_evidence: text(),
}).strict() }).strict().refine((value) => !same(value.details.review_event_id, value.details.contact_event_id)
  && atOrAfter(value.occurred_at, value.details.invalidation.recorded_at) && atOrAfter(value.occurred_at, value.details.invalidation.head_recorded_at));
const atOrAfter = (a: string, b: string) => (labCollectionMicros(a) ?? BigInt(-1)) >= (labCollectionMicros(b) ?? BigInt(0));
export const closureSnapshotSchema = z.object({
  exceptions: z.array(exceptionSnapshotSchema), invalidations: z.array(sourceInvalidationSnapshotSchema), known_invalidation_ids: z.array(guid),
  prepared_intents: z.array(z.object({ intent_id: guid, state: z.literal('prepared'), recorded_at: instant }).strict()),
}).strict().refine((value) => ordered(value.exceptions.map((row) => row.exception_id.toLowerCase()))
  && ordered(value.invalidations.map((row) => row.invalidation_id.toLowerCase())) && ordered(value.known_invalidation_ids.map((id) => id.toLowerCase()))
  && ordered(value.prepared_intents.map((row) => row.intent_id.toLowerCase()))
  && value.invalidations.every((row) => value.known_invalidation_ids.some((id) => same(id, row.invalidation_id))));
const closureCommon = { occurred_at: instant, evidence: text() };
const closureSuccessPayload = z.object({ ...closureCommon, details: z.object({ snapshot: closureSnapshotSchema, outcome: text(),
  review_event_id: guid, contact_event_id: guid, workflow_completed: z.literal(true), review_contact_accepted: z.literal(true),
}).strict() }).strict().refine((value) => !same(value.details.review_event_id, value.details.contact_event_id)
  && !value.details.snapshot.exceptions.length && !value.details.snapshot.invalidations.length && !value.details.snapshot.prepared_intents.length);
const closureDisposition = z.enum(['refused', 'not_performed', 'cancelled', 'transferred']);
const closureWithoutPayload = z.object({ ...closureCommon, details: z.object({ snapshot: closureSnapshotSchema,
  outcome: text(), disposition: closureDisposition, reason: text(), declarations: z.array(z.object({ target_type: z.enum(['exception', 'source_invalidation']),
    target_id: guid, reason: text(), non_delivery_acknowledged: z.literal(true) }).strict()),
}).strict() }).strict().refine((value) => {
  const { snapshot, declarations } = value.details;
  const targets = [...snapshot.exceptions.map((row) => `exception:${row.exception_id.toLowerCase()}`),
    ...snapshot.invalidations.map((row) => `source_invalidation:${row.invalidation_id.toLowerCase()}`)].sort();
  const declared = declarations.map((row) => `${row.target_type}:${row.target_id.toLowerCase()}`).sort();
  return !snapshot.prepared_intents.length && sameSet(targets, declared)
    && snapshot.exceptions.every((row) => atOrAfter(value.occurred_at, row.origin_occurred_at))
    && snapshot.invalidations.every((row) => atOrAfter(value.occurred_at, row.recorded_at) && atOrAfter(value.occurred_at, row.head_recorded_at));
});
const contactPayload = z.object({ ...common, details: z.object({
  channel: z.enum(['phone', 'in_person', 'video', 'secure_message', 'mail', 'other']),
  recipient_type: z.enum(['patient', 'caregiver', 'receiving_professional', 'other']), recipient_reference: text(500),
  outcome: z.enum(['human_reached', 'no_answer', 'refused', 'unable_to_contact']), review_event_id: guid.nullable(),
  review_addressed: z.boolean(), exception_id: guid.nullable(), reason: text().nullable(),
}).strict().refine((d) => (!d.review_addressed || d.outcome === 'human_reached' && d.review_event_id !== null)
  && (d.outcome === 'human_reached' ? d.exception_id === null && d.reason === null : d.exception_id !== null && d.reason !== null)) }).strict();
export const humanCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('record_review'), payload: reviewPayload }).strict(),
  z.object({ command: z.literal('record_contact'), payload: contactPayload }).strict(),
  z.object({ command: z.literal('resolve_exception'), payload: resolutionPayload }).strict(),
  z.object({ command: z.literal('resolve_source_invalidation'), payload: sourceResolutionPayload }).strict(),
  z.object({ command: z.literal('close_success'), payload: closureSuccessPayload }).strict(),
  z.object({ command: z.literal('close_without_completion'), payload: closureWithoutPayload }).strict(),
]);
export const humanCommandNameSchema = z.enum(['record_review', 'record_contact', 'resolve_exception', 'resolve_source_invalidation', 'close_success', 'close_without_completion']);
export const HUMAN_COMMAND_LABELS: Record<z.infer<typeof humanCommandNameSchema>, string> = {
  record_review: 'Professional review', record_contact: 'Documented contact', resolve_exception: 'Barrier resolution',
  resolve_source_invalidation: 'Source-change resolution', close_success: 'Documented workflow completion', close_without_completion: 'Closure without completed care',
};
const command = humanCommandNameSchema;
const processing = z.object({ lab_result_id: guid, evaluation: z.object({ event_id: guid, status: labEvaluationStatusSchema,
  completed_at: instant.nullable(), source_assessment: labSourceAssessmentSchema.nullable(),
}).strict().refine((value) => (value.status === 'pending') === (value.completed_at === null)).nullable() }).strict()
  .superRefine((row, ctx) => {
    const ev = row.evaluation;
    if (ev && !labEvaluationHistorySchema.safeParse({ id: ev.event_id, patient_id: ev.source_assessment?.patient_id ?? '00000000-0000-4000-8000-000000000000',
      lab_result_id: row.lab_result_id, status: ev.status, attempt_count: 0, source_assessment: ev.source_assessment, lab_results: null }).success) {
      ctx.addIssue({ code: 'custom', message: 'Processing proof does not match its exact result.' });
    }
  });
const fact = z.object({ event_id: guid, revision: revision(BigInt(2)), occurred_at: instant, recorded_at: instant,
  command: z.enum(['record_report', 'record_obtained']), payload: z.unknown() }).strict().refine((value) => {
    const parsed = careStepCommandSchema.safeParse({ command: value.command, payload: value.payload });
    return parsed.success && labCollectionMicros(value.occurred_at) !== null
      && labCollectionMicros(value.occurred_at) === labCollectionMicros(parsed.data.payload.occurred_at);
  });
export const humanBasisSchema = z.object({ kind: careKindSchema, composition_event_id: guid.nullable(),
  sources: z.array(compositionDetailSchema.shape.sources.element).max(13), processing: z.array(processing).max(13), operational_event: fact.nullable(),
}).strict().superRefine((basis, ctx) => {
  const reject = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent human evidence basis.' });
  if (basis.kind !== 'laboratory_order') {
    if (basis.composition_event_id !== null || basis.sources.length || basis.processing.length || basis.operational_event
      && basis.operational_event.command !== (basis.kind === 'referral' ? 'record_report' : 'record_obtained')) reject();
    return;
  }
  if (basis.operational_event !== null || !basis.sources.length || !ordered(basis.sources.map((row) => row.analyte))
    || !basis.sources.every((row) => (basis.composition_event_id === null) === (row.entry_id === null))) reject();
  const effective = [...new Set(basis.sources.flatMap((row) => row.head?.effective_lab_result_id ? [row.head.effective_lab_result_id.toLowerCase()] : []))].sort();
  if (!ordered(basis.processing.map((row) => row.lab_result_id.toLowerCase()))
    || !sameSet(effective, basis.processing.map((row) => row.lab_result_id.toLowerCase()))) reject();
  for (const source of basis.sources) {
    if (!source.head?.effective_lab_result_id) continue;
    const proof = basis.processing.find((row) => same(row.lab_result_id, source.head!.effective_lab_result_id!));
    if (!proof || (proof.evaluation?.status ?? null) !== source.evaluation_status) reject();
  }
});
const baseInput = careScopeSchema.extend({ request_id: guid, work_item_id: guid,
  expected_revision: revision(BigInt(1), BigInt('9223372036854775806')), expected_ownership_revision: revision(BigInt(0)),
  command, basis: humanBasisSchema, basis_signature: signature,
  payload: z.union([reviewPayload, contactPayload, resolutionPayload, sourceResolutionPayload, closureSuccessPayload, closureWithoutPayload]),
}).strict();
function inputConsistent(value: z.infer<typeof baseInput>) {
  const parsed = humanCommandSchema.safeParse({ command: value.command, payload: value.payload });
  const fact = value.basis.operational_event;
  return parsed.success && (!fact || validRevision(fact.revision) && validRevision(value.expected_revision)
    && BigInt(fact.revision) <= BigInt(value.expected_revision))
    && (!(parsed.data.command === 'record_review' || parsed.data.command === 'record_contact' && parsed.data.payload.details.review_addressed) || hasReviewEvidence(value.basis))
    && (parsed.data.command !== 'resolve_exception' || validRevision(parsed.data.payload.details.exception.origin_revision)
      && validRevision(value.expected_revision) && BigInt(parsed.data.payload.details.exception.origin_revision) <= BigInt(value.expected_revision))
    && (parsed.data.command !== 'resolve_source_invalidation' || value.basis.kind === 'laboratory_order' && hasReviewEvidence(value.basis)
      && validRevision(value.expected_revision) && validRevision(parsed.data.payload.details.invalidation.composition_revision)
      && BigInt(parsed.data.payload.details.invalidation.composition_revision) < BigInt(value.expected_revision)
      && sourceDispositionMatches(value.basis, parsed.data.payload.details.invalidation, parsed.data.payload.details.disposition))
    && (parsed.data.command !== 'close_success' || closureBasisReady(value.basis))
    && (!('snapshot' in parsed.data.payload.details) || (
      (value.basis.kind === 'laboratory_order' || !parsed.data.payload.details.snapshot.invalidations.length
        && !parsed.data.payload.details.snapshot.known_invalidation_ids.length && !parsed.data.payload.details.snapshot.prepared_intents.length)
      && parsed.data.payload.details.snapshot.exceptions.every((row) => validRevision(row.origin_revision) && validRevision(value.expected_revision)
        && BigInt(row.origin_revision) <= BigInt(value.expected_revision))
      && parsed.data.payload.details.snapshot.invalidations.every((row) => validRevision(row.composition_revision) && validRevision(value.expected_revision)
        && BigInt(row.composition_revision) <= BigInt(value.expected_revision))))
    && value.basis.processing.every((row) => !row.evaluation?.source_assessment
    || same(row.evaluation.source_assessment.patient_id, value.patient_id));
}
export const humanInputSchema = baseInput.refine(inputConsistent);
const reviewStage = { laboratory_order: 'result_received', referral: 'report_received', medication_access: 'obtained' } as const;
function hasReviewEvidence(basis: z.infer<typeof humanBasisSchema>) {
  return basis.kind === 'laboratory_order' ? basis.composition_event_id !== null : basis.operational_event !== null;
}
function closureBasisReady(basis: z.infer<typeof humanBasisSchema>) {
  return hasReviewEvidence(basis) && (basis.kind !== 'laboratory_order' || basis.sources.length > 0 && basis.processing.length > 0
    && basis.sources.every((row) => row.quality === 'available' && row.head !== null && row.head.status !== 'cancelled'
      && row.head.effective_lab_result_id !== null && labCollectionMicros(row.head.collected_at) !== null)
    && basis.processing.every((row) => row.evaluation !== null && ['recorded', 'not_required'].includes(row.evaluation.status)
      && row.evaluation.completed_at !== null));
}
function sourceDispositionMatches(basis: z.infer<typeof humanBasisSchema>, target: z.infer<typeof sourceInvalidationSnapshotSchema>, disposition: string) {
  const source = basis.sources.find((row) => row.root_id !== null && same(row.root_id, target.root_id));
  return disposition === 'retained_in_current_composition' ? !!source && source.analyte === target.analyte && equal(source.head, target.head)
    : !source && basis.composition_event_id !== null && !same(basis.composition_event_id, target.composition_event_id);
}
function validStage(kind: z.infer<typeof careKindSchema>, stage: z.infer<typeof careStepStageSchema>) {
  return ({ laboratory_order: ['requested', 'scheduled', 'collected', 'result_received'],
    referral: ['requested', 'accepted', 'scheduled', 'attended', 'report_received'],
    medication_access: ['requested', 'assistance_requested', 'response_received', 'obtained'] }[kind]).includes(stage);
}
const receiptFields = { request_id: guid, work_item_id: guid, event_id: guid, workflow_revision: revision(BigInt(2)),
  ownership_revision: revision(BigInt(0)), stage: careStepStageSchema, recorded_at: instant, basis: humanBasisSchema,
  basis_signature: signature, exception_id: guid.nullable(), due_at: instant, clinical_review_recorded: z.boolean(),
  addresses_current_review: z.boolean(), communication_confirmed: z.literal(false), care_completed: z.literal(false),
};
const closureReceiptFields = { request_id: guid, work_item_id: guid, event_id: guid, workflow_revision: revision(BigInt(2)),
  ownership_revision: revision(BigInt(0)), stage: careStepStageSchema, recorded_at: instant, basis: humanBasisSchema,
  basis_signature: signature, work_closed: z.literal(true), closed_at: instant, clinical_review_recorded: z.literal(false),
  addresses_current_review: z.literal(false), communication_confirmed: z.literal(false) };
const receipt = z.discriminatedUnion('command', [
  z.object({ ...receiptFields, command: z.literal('record_review') }).strict(),
  z.object({ ...receiptFields, command: z.literal('record_contact') }).strict(),
  z.object({ ...receiptFields, command: z.literal('resolve_exception'), resolved_exception_id: guid, resolution_event_id: guid,
    exception_id: z.null(), clinical_review_recorded: z.literal(false), addresses_current_review: z.literal(false),
  }).strict(),
  z.object({ ...receiptFields, command: z.literal('resolve_source_invalidation'), resolved_invalidation_id: guid, resolution_event_id: guid,
    source_review_attested: z.literal(true), source_contact_attested: z.literal(true), exception_id: z.null(),
    clinical_review_recorded: z.literal(false), addresses_current_review: z.literal(false), stage: z.literal('result_received'),
  }).strict(),
  z.object({ ...closureReceiptFields, command: z.literal('close_success'), care_completed: z.literal(true),
    completion_outcome: z.literal('documented_workflow_completion') }).strict(),
  z.object({ ...closureReceiptFields, command: z.literal('close_without_completion'), care_completed: z.literal(false),
    completion_outcome: closureDisposition }).strict(),
]);
export const humanStateSchema = baseInput.extend({ state: z.enum(['prepared', 'applied', 'cancelled']), recorded_at: instant,
  acknowledged_at: instant.nullable(), receipt: receipt.nullable(),
}).strict().superRefine((value, ctx) => {
  const reject = () => ctx.addIssue({ code: 'custom', message: 'Human evidence receipt disagrees with the frozen request.' });
  if (!inputConsistent(value)) reject();
  if (value.state !== 'applied') { if (value.receipt !== null || value.acknowledged_at !== null) reject(); return; }
  const r = value.receipt;
  if (!r) { reject(); return; }
  if (!same(r.request_id, value.request_id) || !same(r.work_item_id, value.work_item_id) || r.command !== value.command
    || !validRevision(r.workflow_revision) || !validRevision(value.expected_revision)
    || BigInt(r.workflow_revision) !== BigInt(value.expected_revision) + BigInt(1) || r.ownership_revision !== value.expected_ownership_revision
    || r.basis_signature !== value.basis_signature || !equal(r.basis, value.basis) || !validStage(value.basis.kind, r.stage)
    || r.clinical_review_recorded !== (value.command === 'record_review')) reject();
  const parsed = humanCommandSchema.safeParse({ command: value.command, payload: value.payload });
  if (!parsed.success) return;
  if (parsed.data.command === 'close_success' || parsed.data.command === 'close_without_completion') {
    if (!('closed_at' in r) || labCollectionMicros(r.closed_at) !== labCollectionMicros(r.recorded_at)
      || !atOrAfter(r.recorded_at, parsed.data.payload.occurred_at)
      || parsed.data.command === 'close_success' && (r.stage !== reviewStage[value.basis.kind]
        || value.basis.sources.some((source) => source.head && !atOrAfter(r.recorded_at, source.head.collected_at)))
      || parsed.data.command === 'close_without_completion' && r.completion_outcome !== parsed.data.payload.details.disposition) reject();
    return;
  }
  if (!('exception_id' in r)) { reject(); return; }
  if (parsed.data.command === 'record_review') {
    if (r.stage !== reviewStage[value.basis.kind] || r.exception_id !== null || r.addresses_current_review
      || !hasReviewEvidence(value.basis)) reject();
  } else if (parsed.data.command === 'record_contact') {
    const d = parsed.data.payload.details;
    if (r.exception_id?.toLowerCase() !== d.exception_id?.toLowerCase() || r.addresses_current_review !== d.review_addressed
      || d.review_addressed && r.stage !== reviewStage[value.basis.kind]) reject();
  } else if (parsed.data.command === 'resolve_exception') {
    if (r.command !== 'resolve_exception' || !same(r.resolved_exception_id, parsed.data.payload.details.exception.exception_id)
      || !same(r.resolution_event_id, r.event_id)) reject();
  } else if (r.command !== 'resolve_source_invalidation' || !same(r.resolved_invalidation_id, parsed.data.payload.details.invalidation.invalidation_id)
    || !same(r.resolution_event_id, r.event_id)) {
    reject();
  }
});
const latestReview = z.object({ event_id: guid, revision: revision(BigInt(2)), actor_id: guid, occurred_at: instant,
  recorded_at: instant, basis_signature: signature, is_current: z.boolean(), decision: text() }).strict();
const contextFields = { ...careScopeSchema.shape, work_item_id: guid, workflow_revision: revision(), ownership_revision: revision(BigInt(0)),
  kind: careKindSchema, stage: careStepStageSchema, basis: humanBasisSchema, basis_signature: signature, latest_review: latestReview.nullable() };
const sourceContact = z.object({ event_id: guid, revision: revision(BigInt(2)), actor_id: guid, occurred_at: instant, recorded_at: instant,
  review_event_id: guid, basis_signature: signature, channel: contactPayload.shape.details.shape.channel,
  recipient_type: contactPayload.shape.details.shape.recipient_type, recipient_reference: text(500) }).strict();
export const humanContextSchema = z.discriminatedUnion('command', [
  z.object({ ...contextFields, command: z.literal('record_review') }).strict(),
  z.object({ ...contextFields, command: z.literal('record_contact') }).strict(),
  z.object({ ...contextFields, command: z.literal('resolve_exception'), exceptions: z.array(exceptionSnapshotSchema) }).strict(),
  z.object({ ...contextFields, command: z.literal('resolve_source_invalidation'), kind: z.literal('laboratory_order'),
    invalidation: sourceInvalidationSnapshotSchema, contact: sourceContact.nullable() }).strict(),
  z.object({ ...contextFields, command: z.literal('close_success'), snapshot: closureSnapshotSchema, contact: sourceContact.nullable() }).strict(),
  z.object({ ...contextFields, command: z.literal('close_without_completion'), snapshot: closureSnapshotSchema, contact: sourceContact.nullable() }).strict(),
]).superRefine((value, ctx) => {
  const r = value.latest_review, fact = value.basis.operational_event;
  if (value.kind !== value.basis.kind || !validStage(value.kind, value.stage)
    || fact && (!validRevision(fact.revision) || !validRevision(value.workflow_revision)
      || BigInt(fact.revision) > BigInt(value.workflow_revision) || value.stage !== reviewStage[value.kind])
    || value.basis.processing.some((row) => row.evaluation?.source_assessment && !same(row.evaluation.source_assessment.patient_id, value.patient_id))
    || r && (!validRevision(r.revision) || !validRevision(value.workflow_revision) || BigInt(r.revision) > BigInt(value.workflow_revision)
      || r.is_current !== (r.basis_signature === value.basis_signature)
      || r.is_current && (!hasReviewEvidence(value.basis) || value.stage !== reviewStage[value.kind]
        || fact && (!validRevision(fact.revision) || BigInt(fact.revision) >= BigInt(r.revision))))) {
    ctx.addIssue({ code: 'custom', message: 'Current human context is inconsistent.' });
  }
  if (value.command === 'resolve_exception') {
    const ids = new Set<string>();
    for (const [n, item] of value.exceptions.entries()) {
      const before = value.exceptions[n - 1], time = labCollectionMicros(item.next_review_at), prior = before && labCollectionMicros(before.next_review_at);
      if (ids.has(item.exception_id.toLowerCase()) || !validRevision(item.origin_revision) || !validRevision(value.workflow_revision)
        || BigInt(item.origin_revision) > BigInt(value.workflow_revision) || time === null
        || before && (prior === null || time! < prior! || time === prior && item.exception_id.toLowerCase() <= before.exception_id.toLowerCase())) {
        ctx.addIssue({ code: 'custom', message: 'Open exception context is inconsistent.' });
      }
      ids.add(item.exception_id.toLowerCase());
    }
  }
  if ('contact' in value) {
    const c = value.contact;
    if (c && (!r || !same(c.review_event_id, r.event_id) || c.basis_signature !== value.basis_signature
        || !validRevision(c.revision) || !validRevision(r.revision) || !validRevision(value.workflow_revision)
        || BigInt(c.revision) > BigInt(value.workflow_revision) || BigInt(c.revision) <= BigInt(r.revision)
        || !atOrAfter(c.occurred_at, r.occurred_at))) {
      ctx.addIssue({ code: 'custom', message: 'Referenced contact context identities are inconsistent.' });
    }
  }
  const targets = value.command === 'resolve_source_invalidation' ? [value.invalidation] : 'snapshot' in value ? value.snapshot.invalidations : [];
  if (targets.some((target) => !validRevision(target.composition_revision) || !validRevision(value.workflow_revision)
    || BigInt(target.composition_revision) > BigInt(value.workflow_revision))
    || 'snapshot' in value && (value.snapshot.exceptions.some((row) => !validRevision(row.origin_revision) || !validRevision(value.workflow_revision)
      || BigInt(row.origin_revision) > BigInt(value.workflow_revision))
      || value.kind !== 'laboratory_order' && (value.snapshot.invalidations.length || value.snapshot.known_invalidation_ids.length || value.snapshot.prepared_intents.length))) {
    ctx.addIssue({ code: 'custom', message: 'Closure/source context origins are inconsistent.' });
  }
});
export const humanPendingPageSchema = z.object({ items: z.array(humanStateSchema).max(25), next_cursor: guid.nullable() }).strict()
  .refine((value) => ordered(value.items.map((row) => row.request_id.toLowerCase()))
    && value.items.every((row) => row.state !== 'cancelled' && row.acknowledged_at === null)
    && (value.next_cursor === null || value.items.length === 25 && same(value.next_cursor, value.items[24].request_id)));
export type HumanInput = z.infer<typeof humanInputSchema>;
export type HumanState = z.infer<typeof humanStateSchema>;
export type HumanContext = z.infer<typeof humanContextSchema>;
export function closureReady(context: HumanContext): boolean {
  if (context.command !== 'close_success' && context.command !== 'close_without_completion') return false;
  return !context.snapshot.prepared_intents.length && (context.command === 'close_without_completion'
    || !context.snapshot.exceptions.length && !context.snapshot.invalidations.length && closureBasisReady(context.basis)
      && context.stage === reviewStage[context.kind] && !!context.latest_review?.is_current && !!context.contact);
}
// Readiness for a new attestation only; never apply this to private terminal recovery.
export function sourceResolutionReady(context: HumanContext): boolean {
  if (context.command !== 'resolve_source_invalidation') return false;
  const review = context.latest_review, target = context.invalidation, contact = context.contact;
  return context.stage === 'result_received' && !!review?.is_current && !!contact
    && atOrAfter(review.occurred_at, target.recorded_at) && atOrAfter(review.occurred_at, target.head_recorded_at)
    && validRevision(review.revision) && validRevision(target.composition_revision)
    && BigInt(review.revision) > BigInt(target.composition_revision);
}
export function humanInputFromState(state: HumanState): HumanInput {
  const { request_id, actor_id, organization_id, patient_id, work_item_id, expected_revision, expected_ownership_revision,
    command, basis, basis_signature, payload } = state;
  return humanInputSchema.parse({ request_id, actor_id, organization_id, patient_id, work_item_id, expected_revision,
    expected_ownership_revision, command, basis, basis_signature, payload });
}
export function humanMatches(state: HumanState, input: HumanInput): boolean {
  const a = humanInputFromState(state), b = humanInputSchema.parse(input);
  return (['request_id', 'actor_id', 'organization_id', 'patient_id', 'work_item_id'] as const).every((key) => same(a[key], b[key]))
    && a.expected_revision === b.expected_revision && a.expected_ownership_revision === b.expected_ownership_revision && a.command === b.command
    && a.basis_signature === b.basis_signature && equal(a.basis, b.basis) && equal(a.payload, b.payload);
}
export function validateNewHumanInput(input: unknown, now = Date.now()): HumanInput | null {
  const parsed = humanInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const occurred = labCollectionMicros(parsed.data.payload.occurred_at);
  const cutoff = BigInt(Math.trunc(now)) * BigInt(1000);
  if (occurred === null || occurred > cutoff) return null;
  if ('next_review_at' in parsed.data.payload) {
    const due = labCollectionMicros(parsed.data.payload.next_review_at);
    return due !== null && due > cutoff ? parsed.data : null;
  }
  if (parsed.data.command === 'close_success' && parsed.data.basis.sources.some((row) => row.head
    && (labCollectionMicros(row.head.collected_at) ?? cutoff + BigInt(1)) > cutoff)) return null;
  return parsed.data;
}
