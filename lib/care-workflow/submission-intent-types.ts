import { z } from 'zod';
import { careScopeSchema } from './types';
import { labEvaluationStatusSchema } from '@/lib/labs/evaluation';
import { labCollectionMicros } from '@/lib/labs/quality';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const revision = (minimum: bigint) => z.string().refine((value) => /^(0|[1-9]\d{0,18})$/.test(value)
  && BigInt(value) >= minimum && BigInt(value) <= BigInt('9223372036854775807'));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const submissionIntentAnalyteSchema = z.enum(['potassium', 'creatinine', 'egfr', 'sodium']);
const analytes = z.array(submissionIntentAnalyteSchema).max(4).refine((items) => new Set(items).size === items.length);
export const submissionIntentPayloadSchema = z.object({
  analytes: analytes.refine((items) => items.length > 0),
  evidence: z.string().refine((value) => [...value].length <= 1000 && [...value.replace(/^ +| +$/g, '')].length >= 3),
  occurred_at: instant,
}).strict();
export const submissionIntentInputSchema = careScopeSchema.extend({ intent_id: guid, work_item_id: guid, submission_request_id: guid,
  expected_revision: revision(BigInt(1)), expected_ownership_revision: revision(BigInt(0)), payload: submissionIntentPayloadSchema }).strict();
const submission = z.object({ status: z.enum(['awaiting_save', 'saved_not_linked', 'saved_reconciled', 'submission_cancelled']),
  lab_result_id: guid.nullable(), event_id: guid.nullable(), evaluation_status: labEvaluationStatusSchema.nullable(),
  saved_at: instant.nullable(), acknowledged_at: instant.nullable(), recorded_analytes: analytes, missing_analytes: analytes,
}).strict().superRefine((value, ctx) => {
  const saved = value.status === 'saved_not_linked' || value.status === 'saved_reconciled';
  if (saved ? value.lab_result_id === null || value.event_id === null || value.evaluation_status === null || value.saved_at === null || value.recorded_analytes.length === 0
    : value.lab_result_id !== null || value.event_id !== null || value.evaluation_status !== null || value.saved_at !== null || value.acknowledged_at !== null || value.recorded_analytes.length !== 0) {
    ctx.addIssue({ code: 'custom', message: 'Submission state and saved evidence disagree.' });
  }
  if (value.recorded_analytes.some((key, n, all) => n > 0 && key <= all[n - 1])) ctx.addIssue({ code: 'custom', message: 'Noncanonical recorded analytes.' });
});
const reconciliation = z.object({ event_id: guid, disposition: z.enum(['linked', 'not_used']),
  matched_analytes: analytes, missing_analytes: analytes, recorded_at: instant }).strict();
export const submissionIntentSubmissionSchema = submission;
export const submissionIntentStateSchema = submissionIntentInputSchema.extend({ state: z.enum(['prepared', 'cancelled', 'reconciled']),
  recorded_at: instant, cancelled_at: instant.nullable(), reconciled_at: instant.nullable(), reconciliation: reconciliation.nullable(), submission,
  result_linked: z.boolean(), clinical_review_recorded: z.literal(false), care_completed: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const resolved = value.state === 'reconciled';
  const linked = resolved && value.reconciliation?.disposition === 'linked';
  const expectedMatched = linked ? value.payload.analytes.filter((key) => value.submission.recorded_analytes.includes(key)) : [];
  if ((value.state === 'cancelled') !== (value.cancelled_at !== null)
    || (value.state === 'cancelled' && value.submission.status !== 'submission_cancelled')
    || resolved !== (value.reconciled_at !== null) || resolved !== (value.reconciliation !== null)
    || resolved !== (value.submission.status === 'saved_reconciled') || value.result_linked !== linked
    || (linked && expectedMatched.length === 0)
    || (value.reconciliation !== null && (JSON.stringify(value.reconciliation.matched_analytes) !== JSON.stringify(expectedMatched)
      || JSON.stringify(value.reconciliation.missing_analytes) !== JSON.stringify(value.submission.missing_analytes)))
    || JSON.stringify(value.submission.missing_analytes) !== JSON.stringify(value.payload.analytes.filter((key) => !value.submission.recorded_analytes.includes(key)))) {
    ctx.addIssue({ code: 'custom', message: 'Intention cancellation or missing-analyte projection is inconsistent.' });
  }
});
export const submissionIntentPageSchema = z.object({ items: z.array(submissionIntentStateSchema).max(25), next_cursor: guid.nullable() }).strict()
  .superRefine((value, ctx) => {
    const ids = value.items.map((item) => item.intent_id.toLowerCase());
    if (value.items.some((item) => item.state !== 'prepared') || ids.some((id, n) => n > 0 && id <= ids[n - 1])
      || (value.next_cursor !== null && (value.items.length !== 25 || !same(value.next_cursor, ids[24])))) {
      ctx.addIssue({ code: 'custom', message: 'Pending intention page is incomplete or inconsistent.' });
    }
  });
export type SubmissionIntentInput = z.infer<typeof submissionIntentInputSchema>;
export type SubmissionIntentState = z.infer<typeof submissionIntentStateSchema>;
export type SubmissionIntentPage = z.infer<typeof submissionIntentPageSchema>;
export function submissionIntentInputFromState(state: SubmissionIntentState): SubmissionIntentInput {
  const { intent_id, actor_id, organization_id, patient_id, work_item_id, submission_request_id, expected_revision, expected_ownership_revision, payload } = state;
  return submissionIntentInputSchema.parse({ intent_id, actor_id, organization_id, patient_id, work_item_id, submission_request_id, expected_revision, expected_ownership_revision, payload });
}
export function submissionIntentMatches(state: SubmissionIntentState, input: SubmissionIntentInput): boolean {
  const actual = submissionIntentInputFromState(state); const expected = submissionIntentInputSchema.parse(input);
  return (['intent_id', 'actor_id', 'organization_id', 'patient_id', 'work_item_id', 'submission_request_id'] as const).every((key) => same(actual[key], expected[key]))
    && actual.expected_revision === expected.expected_revision && actual.expected_ownership_revision === expected.expected_ownership_revision
    && JSON.stringify(actual.payload) === JSON.stringify(expected.payload);
}
/** Fresh validation is separate: a historical record never acquires new timestamps. */
export function validateNewSubmissionIntent(input: unknown, now = Date.now()): SubmissionIntentInput | null {
  const parsed = submissionIntentInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const occurred = labCollectionMicros(parsed.data.payload.occurred_at);
  return occurred !== null && occurred <= BigInt(Math.trunc(now)) * BigInt(1000) ? parsed.data : null;
}
