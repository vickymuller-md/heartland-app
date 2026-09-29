import { z } from 'zod';
import { careAnalyteSchema, careKindSchema, careRequestPayloadSchema, careScopeSchema, type CareScope } from './types';
import { compositionHistorySchema, compositionPayloadSchema, compositionReceiptSchema } from './composition-types';
import { labCollectionMicros } from '@/lib/labs/quality';
import { careStepCommandSchema, careStepStageSchema, careExceptionCodeSchema, type CareStepCommand } from './step-command';
import { humanStateSchema, humanCommandSchema, humanInputSchema } from './human-types';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).refine((value) =>
  (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1].length ?? 0) <= 6);
const text = (max: number) => z.string().refine((value) => [...value].length <= max
  && [...value.replace(/^ +| +$/g, '')].length >= 3);
// bigint revisions travel as strings: never round them through JavaScript numbers.
const revision = (min: bigint, max = BigInt('9223372036854775807')) => z.string().regex(/^(0|[1-9]\d*)$/)
  .refine((value) => /^(0|[1-9]\d*)$/.test(value) && value.length <= 19 && BigInt(value) >= min && BigInt(value) <= max);
export { careStepStageSchema, careExceptionCodeSchema, careStepCommandSchema, type CareStepCommand } from './step-command';
const receipt = z.object({ request_id: guid, work_item_id: guid, event_id: guid,
  workflow_revision: revision(BigInt(2)), ownership_revision: revision(BigInt(0)), stage: careStepStageSchema,
  exception_id: guid.nullable(), due_at: instant, recorded_at: instant,
  clinical_review_recorded: z.literal(false), communication_confirmed: z.literal(false), care_completed: z.literal(false),
}).strict();
export const careStepStateSchema = z.object({
  request_id: guid, work_item_id: guid, actor_id: guid, organization_id: guid, patient_id: guid,
  expected_revision: revision(BigInt(1), BigInt('9223372036854775806')), expected_ownership_revision: revision(BigInt(0)),
  command: z.string(), payload: z.unknown(), state: z.enum(['prepared', 'applied', 'cancelled']),
  recorded_at: instant, acknowledged_at: instant.nullable(), receipt: receipt.nullable(),
}).strict().superRefine((value, ctx) => {
  const command = careStepCommandSchema.safeParse({ command: value.command, payload: value.payload });
  if (!command.success) ctx.addIssue({ code: 'custom', message: 'Invalid frozen command payload.' });
  if (value.state === 'applied') {
    if (!value.receipt || value.receipt.request_id !== value.request_id || value.receipt.work_item_id !== value.work_item_id
      || !/^[1-9]\d{0,18}$/.test(value.expected_revision) || !/^[1-9]\d{0,18}$/.test(value.receipt.workflow_revision)
      || BigInt(value.receipt.workflow_revision) !== BigInt(value.expected_revision) + BigInt(1)
      || value.receipt.ownership_revision !== value.expected_ownership_revision) {
      ctx.addIssue({ code: 'custom', message: 'Receipt identity or revision mismatch.' });
    }
    if (command.success && value.receipt) {
      const expectedStage = { record_schedule: 'scheduled', record_collection: 'collected', record_destination_acceptance: 'accepted',
        record_attendance: 'attended', record_report: 'report_received', record_assistance_request: 'assistance_requested',
        record_assistance_response: 'response_received', record_obtained: 'obtained' } as const;
      const c = command.data;
      if (c.command !== 'record_exception' && value.receipt.stage !== expectedStage[c.command]) ctx.addIssue({ code: 'custom', message: 'Unexpected resulting stage.' });
      if (c.command === 'record_exception' ? value.receipt.exception_id?.toLowerCase() !== c.payload.details.exception_id.toLowerCase()
        : c.command === 'record_assistance_response' && c.payload.details.outcome === 'denied'
          ? value.receipt.exception_id === null : value.receipt.exception_id !== null) {
        ctx.addIssue({ code: 'custom', message: 'Exception receipt does not match the command.' });
      }
    }
  } else if (value.receipt !== null || value.acknowledged_at !== null) ctx.addIssue({ code: 'custom', message: 'Unapplied step cannot have a receipt.' });
});
export type CareStepState = z.infer<typeof careStepStateSchema>;

export type CareStepInput = CareScope & CareStepCommand & {
  request_id: string; work_item_id: string; expected_revision: string; expected_ownership_revision: string;
};
export const careStepInputSchema = careScopeSchema.extend({ request_id: guid, work_item_id: guid,
  expected_revision: revision(BigInt(1), BigInt('9223372036854775806')), expected_ownership_revision: revision(BigInt(0)),
  command: z.string(), payload: z.unknown(),
}).strict().refine((value) => careStepCommandSchema.safeParse({ command: value.command, payload: value.payload }).success);
export const careStepPageSchema = z.object({ items: z.array(careStepStateSchema).max(25), next_cursor: guid.nullable() }).strict();
export type CareStepPage = z.infer<typeof careStepPageSchema>;
export type CareStepResult = { data: CareStepState; error: null } | { data: null; error: string };
export const CARE_STEP_UNCONFIRMED = 'The step could not be confirmed. Check its saved state with the same request ID. Do not create a replacement or change its frozen revisions.';
export const CARE_STEP_READ_UNAVAILABLE = 'The complete follow-up state could not be verified. New steps remain unavailable until it can be loaded.';
export const careWorkflowReadSchema = z.object({ actor_id: guid, patient_id: guid, work_item_id: guid }).strict();
export type CareWorkflowRead = z.infer<typeof careWorkflowReadSchema>;

const eventSchema = z.object({ id: guid, actor_id: guid, revision: revision(BigInt(2)),
  ownership_revision: revision(BigInt(0)), from_stage: careStepStageSchema, to_stage: careStepStageSchema,
  occurred_at: instant, recorded_at: instant, command: z.string(), payload: z.unknown(),
}).strict().refine((value) => careStepCommandSchema.safeParse({ command: value.command, payload: value.payload }).success);
const compositionEventSchema = z.object({ id: guid, revision: revision(BigInt(2)), ownership_revision: revision(BigInt(0)),
  actor_id: guid, from_stage: careStepStageSchema, to_stage: careStepStageSchema,
  occurred_at: instant, recorded_at: instant, payload: compositionPayloadSchema, receipt: compositionReceiptSchema,
}).strict().refine((value) => compositionHistorySchema.safeParse({ work_item_id: value.receipt.work_item_id,
  items: [{ payload: value.payload, receipt: value.receipt }], next_cursor: null }).success
  && value.to_stage === value.receipt.stage && value.id.toLowerCase() === value.receipt.event_id.toLowerCase()
  && value.revision === value.receipt.workflow_revision && value.ownership_revision === value.receipt.ownership_revision
  && labCollectionMicros(value.occurred_at) !== null && labCollectionMicros(value.occurred_at) === labCollectionMicros(value.payload.occurred_at)
  && labCollectionMicros(value.recorded_at) !== null && labCollectionMicros(value.recorded_at) === labCollectionMicros(value.receipt.recorded_at));
const sameId = (a: string | null, b: string | null) => a?.toLowerCase() === b?.toLowerCase();
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, n) => jsonEqual(v, b[n]));
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length && Object.keys(x).every((key) => Object.hasOwn(y, key) && jsonEqual(x[key], y[key]));
}
const humanEventSchema = z.object({ id: guid, revision: revision(BigInt(2)), ownership_revision: revision(BigInt(0)),
  actor_id: guid, from_stage: careStepStageSchema, to_stage: careStepStageSchema, occurred_at: instant, recorded_at: instant,
  request: z.object({ ...humanInputSchema.shape, recorded_at: instant }).strict(), receipt: humanStateSchema.shape.receipt.unwrap(),
}).strict().refine((value) => {
  // Only reuse receipt validation. No synthesized recovery state/ACK is projected or displayed.
  const decoded = humanStateSchema.safeParse({ ...value.request, state: 'applied', acknowledged_at: null, receipt: value.receipt });
  return decoded.success && sameId(value.id, value.receipt.event_id) && sameId(value.actor_id, value.request.actor_id)
    && value.revision === value.receipt.workflow_revision && value.ownership_revision === value.receipt.ownership_revision
    && value.from_stage === value.to_stage && value.to_stage === value.receipt.stage
    && labCollectionMicros(value.occurred_at) !== null && labCollectionMicros(value.occurred_at) === labCollectionMicros(value.request.payload.occurred_at)
    && labCollectionMicros(value.recorded_at) !== null && labCollectionMicros(value.recorded_at) === labCollectionMicros(value.receipt.recorded_at);
});
export const careWorkflowDetailSchema = z.object({
  work_item_id: guid, patient_id: guid, organization_id: guid, assigned_to: guid.nullable(),
  accepted_at: instant.nullable(), accepted_by: guid.nullable(), transfer_pending_to: guid.nullable(),
  ownership_revision: revision(BigInt(0)), due_at: instant, kind: careKindSchema, stage: careStepStageSchema,
  revision: revision(BigInt(1)), requested_analytes: z.array(careAnalyteSchema), request: careRequestPayloadSchema,
  events: z.array(z.object({ id: guid, actor_id: guid, revision: z.literal('1'), event_type: z.literal('request_recorded'),
    occurred_at: instant, recorded_at: instant }).strict()).length(1),
  // The initializer copies the original purpose (up to 1,000 characters), not a step's 500-character action.
  next_action: text(1000), next_review_at: instant,
  work_status: z.enum(['new', 'reviewed', 'actioned', 'awaiting', 'due', 'closed']), steps: z.array(eventSchema), compositions: z.array(compositionEventSchema), humans: z.array(humanEventSchema),
  exceptions: z.array(z.object({ id: guid, origin_event_id: guid.nullable(), human_origin_event_id: guid.nullable(), code: z.enum([...careExceptionCodeSchema.options, 'assistance_denied']),
    reason: text(1000), next_action: text(500), next_review_at: instant, recorded_at: instant }).strict()
    .refine((item) => (item.origin_event_id === null) !== (item.human_origin_event_id === null))),
}).strict().superRefine((value, ctx) => {
  if (value.request.kind !== value.kind || JSON.stringify(value.request.analytes) !== JSON.stringify(value.requested_analytes)
    || value.revision !== String(value.steps.length + value.compositions.length + value.humans.length + 1)) ctx.addIssue({ code: 'custom', message: 'Inconsistent workflow history.' });
  let stage: z.infer<typeof careStepStageSchema> = 'requested';
  const ids = new Set<string>(value.events.map((event) => event.id.toLowerCase()));
  const mixed = careWorkflowTimeline(value);
  const requiredAnalytes = [...value.requested_analytes].sort();
  let previousComposition: string | null = null;
  let latestComposition: z.infer<typeof compositionEventSchema> | null = null;
  let latestFact: z.infer<typeof eventSchema> | null = null;
  let latestReview: z.infer<typeof humanEventSchema> | null = null;
  const reviews = new Map<string, z.infer<typeof humanEventSchema>>();
  type Head = NonNullable<z.infer<typeof compositionReceiptSchema>['sources'][number]['observed_head']>;
  const observedHeads = new Map<string, Head>();
  const observeHead = (root: string | null, head: Head | null) => {
    if (!root || !head) return;
    const before = observedHeads.get(root.toLowerCase());
    const reject = () => ctx.addIssue({ code: 'custom', message: 'Source version regressed or immutable evidence changed.' });
    const b = revision(BigInt(1)).safeParse(head.revision);
    if (!b.success) { reject(); return; }
    if (before) {
      const a = revision(BigInt(1)).safeParse(before.revision);
      if (!a.success || BigInt(b.data) < BigInt(a.data)) { reject(); return; }
      if (b.data === a.data) {
        if (!sameId(head.version_id, before.version_id) || head.status !== before.status
          || !sameId(head.effective_lab_result_id, before.effective_lab_result_id) || head.value !== before.value
          || labCollectionMicros(head.collected_at) !== labCollectionMicros(before.collected_at)) reject();
      } else if (sameId(head.version_id, before.version_id)) reject();
    }
    observedHeads.set(root.toLowerCase(), head);
  };
  for (const [index, item] of mixed.entries()) {
    const event = item.event;
    if (item.revision !== String(index + 2) || event.from_stage !== stage || ids.has(item.id.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: 'Incomplete or inconsistent mixed history.' });
    }
    if (item.kind === 'step') {
      const command = careStepCommandSchema.safeParse({ command: item.event.command, payload: item.event.payload });
      if (!command.success || !availableCareCommands(value.kind, stage).includes(command.data.command)
        || (command.success && event.to_stage !== (command.data.command === 'record_exception' ? stage : CARE_STEP_TARGET[command.data.command]))) {
        ctx.addIssue({ code: 'custom', message: 'Inconsistent step history.' });
      }
      if (command.success && ['record_report', 'record_obtained'].includes(command.data.command)) latestFact = item.event;
    } else if (item.kind === 'composition') {
      const { receipt, payload } = item.event;
      const hasSource = payload.sources.some((source) => source.root_id !== null);
      if (value.kind !== 'laboratory_order' || receipt.work_item_id.toLowerCase() !== value.work_item_id.toLowerCase()
        || (receipt.previous_event_id?.toLowerCase() ?? null) !== previousComposition
        || !['requested', 'scheduled', 'collected', 'result_received'].includes(stage)
        || event.to_stage !== (hasSource ? 'result_received' : stage)
        || JSON.stringify(payload.sources.map((source) => source.analyte)) !== JSON.stringify(requiredAnalytes)) {
        ctx.addIssue({ code: 'custom', message: 'Inconsistent laboratory composition history.' });
      }
      previousComposition = receipt.event_id.toLowerCase();
      latestComposition = item.event;
      for (const source of receipt.sources) observeHead(source.root_id, source.observed_head);
    } else {
      const { request, receipt } = item.event, basis = request.basis;
      const reject = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent human evidence history.' });
      if (!sameId(request.work_item_id, value.work_item_id) || !sameId(request.patient_id, value.patient_id)
        || !sameId(request.organization_id, value.organization_id) || basis.kind !== value.kind) reject();
      if (value.kind === 'laboratory_order') {
        if (!sameId(basis.composition_event_id, previousComposition)
          || !jsonEqual(basis.sources.map((row) => row.analyte), requiredAnalytes)) reject();
        for (const row of basis.sources) {
          const historical = latestComposition?.receipt.sources.find((source) => source.analyte === row.analyte);
          if (latestComposition ? !historical || !sameId(row.root_id, historical.root_id)
            || !sameId(row.observed_version_id, historical.observed_head?.version_id ?? null)
            : row.root_id !== null || row.observed_version_id !== null) reject();
          observeHead(row.root_id, row.head);
        }
      } else {
        const fact = basis.operational_event;
        if (latestFact ? !fact || !sameId(fact.event_id, latestFact.id) || fact.revision !== latestFact.revision
          || fact.command !== latestFact.command || !jsonEqual(fact.payload, latestFact.payload)
          || labCollectionMicros(fact.occurred_at) !== labCollectionMicros(latestFact.occurred_at)
          || labCollectionMicros(fact.recorded_at) !== labCollectionMicros(latestFact.recorded_at) : fact !== null) reject();
      }
      const command = humanCommandSchema.safeParse({ command: request.command, payload: request.payload });
      if (!command.success) reject();
      else if (command.data.command === 'record_review') {
        latestReview = item.event; reviews.set(item.id.toLowerCase(), item.event);
      } else {
        const d = command.data.payload.details;
        const referenced = d.review_event_id === null ? null : reviews.get(d.review_event_id.toLowerCase());
        if (d.review_event_id !== null && !referenced) reject();
        if (d.review_addressed && (!latestReview || !sameId(d.review_event_id, latestReview.id)
          || !jsonEqual(basis, latestReview.request.basis) || request.basis_signature !== latestReview.request.basis_signature
          || (labCollectionMicros(request.payload.occurred_at) ?? BigInt(-1)) < (labCollectionMicros(latestReview.occurred_at) ?? BigInt(0)))) reject();
        if (d.outcome !== 'human_reached') {
          const barrier = value.exceptions.find((row) => sameId(row.id, d.exception_id));
          if (!barrier || !sameId(barrier.human_origin_event_id, item.id) || barrier.origin_event_id !== null
            || barrier.code !== d.outcome || barrier.reason !== d.reason || barrier.next_action !== request.payload.next_action
            || labCollectionMicros(barrier.next_review_at) !== labCollectionMicros(request.payload.next_review_at)
            || !sameId(receipt.exception_id, barrier.id)) reject();
        }
      }
    }
    ids.add(item.id.toLowerCase()); stage = event.to_stage;
  }
  if (stage !== value.stage || (value.kind !== 'laboratory_order' && stage === 'result_received')
    || new Set(value.exceptions.map((item) => item.id.toLowerCase())).size !== value.exceptions.length
    || value.exceptions.some((item) => item.origin_event_id !== null
      ? !value.steps.some((event) => sameId(event.id, item.origin_event_id))
      : !value.humans.some((event) => {
        const c = humanCommandSchema.safeParse({ command: event.request.command, payload: event.request.payload });
        return sameId(event.id, item.human_origin_event_id) && c.success && c.data.command === 'record_contact'
          && c.data.payload.details.outcome !== 'human_reached' && sameId(c.data.payload.details.exception_id, item.id);
      }))) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent stage or exception origin.' });
  }
});
export type CareWorkflowDetail = z.infer<typeof careWorkflowDetailSchema>;
type TimelineSource = { steps: z.infer<typeof eventSchema>[]; compositions: z.infer<typeof compositionEventSchema>[]; humans: z.infer<typeof humanEventSchema>[] };
export function careWorkflowTimeline(value: TimelineSource) {
  const events = [
    ...value.steps.map((event) => ({ kind: 'step' as const, id: event.id, revision: event.revision, event })),
    ...value.compositions.map((event) => ({ kind: 'composition' as const, id: event.id, revision: event.revision, event })),
    ...value.humans.map((event) => ({ kind: 'human' as const, id: event.id, revision: event.revision, event })),
  ];
  // Refinement can receive invalid revision strings; never throw while decoding an error.
  const safe = (value: string) => /^[1-9]\d{0,18}$/.test(value) ? BigInt(value) : BigInt(-1);
  return events.sort((a, b) => safe(a.revision) < safe(b.revision) ? -1 : safe(a.revision) > safe(b.revision) ? 1 : 0);
}
export const CARE_STEP_LABELS: Record<CareStepCommand['command'], string> = {
  record_schedule: 'Record appointment', record_collection: 'Record specimen collection',
  record_destination_acceptance: 'Record destination acceptance', record_attendance: 'Record attendance',
  record_report: 'Record report received', record_assistance_request: 'Record assistance request',
  record_assistance_response: 'Record assistance response', record_obtained: 'Record medication obtained',
  record_exception: 'Record a barrier',
};
export const CARE_STAGE_LABELS: Record<z.infer<typeof careStepStageSchema>, string> = {
  requested: 'Requested', scheduled: 'Appointment recorded', collected: 'Collection recorded',
  result_received: 'Result source associated (historical stage)',
  accepted: 'Destination accepted', attended: 'Attendance recorded', report_received: 'Report received',
  assistance_requested: 'Assistance requested', response_received: 'Assistance response recorded', obtained: 'Obtained (documented source)',
};
const CARE_STEP_TARGET = { record_schedule: 'scheduled', record_collection: 'collected', record_destination_acceptance: 'accepted',
  record_attendance: 'attended', record_report: 'report_received', record_assistance_request: 'assistance_requested',
  record_assistance_response: 'response_received', record_obtained: 'obtained' } as const;
export function availableCareCommands(kind: z.infer<typeof careKindSchema>, stage: z.infer<typeof careStepStageSchema>): CareStepCommand['command'][] {
  const commands: CareStepCommand['command'][] = [];
  if ((kind === 'laboratory_order' && stage === 'requested') || (kind === 'referral' && stage === 'accepted')) commands.push('record_schedule');
  if (kind === 'laboratory_order' && ['requested', 'scheduled'].includes(stage)) commands.push('record_collection');
  if (kind === 'referral') {
    if (stage === 'requested') commands.push('record_destination_acceptance');
    if (stage === 'scheduled') commands.push('record_attendance');
    if (stage === 'attended') commands.push('record_report');
  }
  if (kind === 'medication_access') {
    if (stage === 'requested') commands.push('record_assistance_request');
    if (['assistance_requested', 'response_received'].includes(stage)) commands.push('record_assistance_response');
    if (stage === 'response_received') commands.push('record_obtained');
  }
  return [...commands, 'record_exception'];
}
export function canRecordCareStep(detail: CareWorkflowDetail, actorId: string): boolean {
  return detail.assigned_to === actorId && detail.accepted_by === actorId && detail.accepted_at !== null
    && detail.transfer_pending_to === null && detail.work_status !== 'closed';
}
export function careStepInputFromState(state: CareStepState): CareStepInput {
  const { actor_id, organization_id, patient_id, request_id, work_item_id, expected_revision, expected_ownership_revision } = state;
  return { actor_id, organization_id, patient_id, request_id, work_item_id, expected_revision, expected_ownership_revision,
    ...careStepCommandSchema.parse({ command: state.command, payload: state.payload }) };
}
export function careStepMatches(state: CareStepState, input: CareStepInput): boolean {
  // Parsing both commands imposes the same property order without rewriting evidence or timestamps.
  const actual = careStepInputFromState(state);
  const expected = { ...input, ...careStepCommandSchema.parse({ command: input.command, payload: input.payload }) };
  return (['actor_id', 'organization_id', 'patient_id', 'request_id', 'work_item_id', 'expected_revision',
    'expected_ownership_revision', 'command'] as const).every((key) => actual[key] === expected[key])
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
export function validateNewCareStep(input: unknown, now = Date.now()): CareStepCommand | null {
  const parsed = careStepCommandSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const result = parsed.data;
  const micros = (value: string) => BigInt(Date.parse(value)) * BigInt(1000)
    + BigInt((/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '').padEnd(6, '0').slice(3));
  if (micros(result.payload.occurred_at) > BigInt(now) * BigInt(1000)
    || micros(result.payload.next_review_at) <= BigInt(now) * BigInt(1000)) return null;
  if (result.command === 'record_schedule' && result.payload.details.appointment_at !== null) {
    const { appointment_at: at, appointment_date: date, appointment_timezone: zone } = result.payload.details;
    try {
      if (!zone || (zone !== 'UTC' && !zone.includes('/'))) return null;
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at));
      const part = (type: string) => parts.find((item) => item.type === type)?.value;
      const wall = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
      if (wall !== at.slice(0, 19) || wall.slice(0, 10) !== date) return null;
    } catch { return null; }
  }
  return result;
}
