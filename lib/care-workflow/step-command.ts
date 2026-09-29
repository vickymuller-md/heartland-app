import { z } from 'zod';
const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).refine((value) =>
  (/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1].length ?? 0) <= 6);
const text = (max: number) => z.string().refine((value) => [...value].length <= max
  && [...value.replace(/^ +| +$/g, '')].length >= 3);
export const careStepStageSchema = z.enum(['requested', 'scheduled', 'collected', 'accepted', 'attended',
  'report_received', 'assistance_requested', 'response_received', 'obtained', 'result_received']);
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
export type CareStepCommand = z.infer<typeof careStepCommandSchema>;
