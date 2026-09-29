import { z } from 'zod';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).refine((value) =>
  (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1].length ?? 0) <= 6);
const text = (max: number) => z.string().refine((value) => [...value].length <= max
  && [...value.replace(/^ +| +$/g, '')].length >= 3);
// bigint revisions travel as strings: never round them through JavaScript numbers.
const revision = (min: bigint, max = BigInt('9223372036854775807')) => z.string().regex(/^(0|[1-9]\d*)$/)
  .refine((value) => /^(0|[1-9]\d*)$/.test(value) && value.length <= 19 && BigInt(value) >= min && BigInt(value) <= max);
export const careStepStageSchema = z.enum(['requested', 'scheduled', 'collected', 'accepted', 'attended',
  'report_received', 'assistance_requested', 'response_received', 'obtained']);
export const careExceptionCodeSchema = z.enum(['no_answer', 'refused', 'unable_to_contact', 'destination_refused',
  'missed_appointment', 'report_missing', 'medication_not_obtained', 'not_performed', 'cancelled', 'other']);
const base = { occurred_at: instant, evidence: text(1000), next_action: text(500), next_review_at: instant };
const payload = <T extends z.ZodType>(details: T) => z.object({ ...base, details }).strict();
const schedule = z.object({ appointment_date: z.iso.date(), appointment_at: instant.nullable(),
  appointment_timezone: z.string().min(1).max(100).nullable() }).strict().refine((value) =>
  (value.appointment_at === null) === (value.appointment_timezone === null));
export const careStepCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('record_schedule'), payload: payload(schedule) }).strict(),
  z.object({ command: z.literal('record_collection'), payload: payload(z.object({}).strict()) }).strict(),
  z.object({ command: z.literal('record_destination_acceptance'), payload: payload(z.object({ destination: text(500) }).strict()) }).strict(),
  z.object({ command: z.literal('record_attendance'), payload: payload(z.object({}).strict()) }).strict(),
  z.object({ command: z.literal('record_report'), payload: payload(z.object({ report_reference: text(1000) }).strict()) }).strict(),
  z.object({ command: z.literal('record_assistance_request'), payload: payload(z.object({ assistance_program: text(500), request_reference: text(1000) }).strict()) }).strict(),
  z.object({ command: z.literal('record_assistance_response'), payload: payload(z.object({ outcome: z.enum(['approved', 'denied', 'pending', 'other']), response_reference: text(1000) }).strict()) }).strict(),
  z.object({ command: z.literal('record_obtained'), payload: payload(z.object({ source: z.enum(['patient_report', 'professional_verification']) }).strict()) }).strict(),
  z.object({ command: z.literal('record_exception'), payload: payload(z.object({ exception_id: guid, code: careExceptionCodeSchema, reason: text(1000) }).strict()) }).strict(),
]);
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
export type CareStepCommand = z.infer<typeof careStepCommandSchema>;
export type CareStepState = z.infer<typeof careStepStateSchema>;
