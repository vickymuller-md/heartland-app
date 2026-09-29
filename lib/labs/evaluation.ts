import { z } from 'zod';

export const labEvaluationStatusSchema = z.enum(['pending', 'recorded', 'not_required', 'invalidated']);
export type LabEvaluationStatus = z.infer<typeof labEvaluationStatusSchema>;
export const labReceiptSchema = z.object({ lab_result_id: z.guid(), event_id: z.guid(), status: labEvaluationStatusSchema }).strict();
export const labReceiptRowsSchema = z.array(labReceiptSchema).length(1);
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const revision = z.string().regex(/^[1-9]\d{0,18}$/).refine((s) => /^[1-9]\d{0,18}$/.test(s) && BigInt(s) <= BigInt('9223372036854775807'));
const identity = { root_id: z.guid().nullable(), version_id: z.guid().nullable(), revision: revision.nullable() };
const source = z.object({ ...identity, lab_result_id: z.guid(), value: z.string().max(256), collected_at: instant }).strict();
const head = z.object({ ...identity, status: z.enum(['original', 'corrected', 'cancelled']),
  effective_lab_result_id: z.guid().nullable(), value: z.string().max(256).nullable(), collected_at: instant }).strict();
const entry = z.object({ reason: z.enum(['not_recorded', 'effective', 'replaced', 'cancelled']),
  event_source: source.nullable(), observed_head: head.nullable() }).strict();
function same(a: string | null, b: string | null) { return a?.toLowerCase() === b?.toLowerCase(); }
function consistent(s: z.infer<typeof source> | z.infer<typeof head>) {
  return (s.root_id === null) === (s.version_id === null) && (s.root_id === null) === (s.revision === null);
}
function micros(s: string) {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(s)?.[1] ?? '';
  return BigInt(Date.parse(s)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3));
}
export const labSourceAssessmentSchema = z.object({
  recipe: z.literal('immediate-effective-v1'), evaluated_at: instant, patient_id: z.guid(),
  lab_result_id: z.guid(), original_lab_result_id: z.guid(),
  analytes: z.object({ potassium: entry, egfr: entry }).strict(),
}).strict().superRefine((a, ctx) => {
  const reject = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent historical source assessment' });
  for (const e of Object.values(a.analytes)) {
    const s = e.event_source; const h = e.observed_head;
    if (e.reason === 'not_recorded') { if (s !== null || h !== null) reject(); continue; }
    if (!s || !h) { reject(); continue; }
    if (!instant.safeParse(a.evaluated_at).success || !instant.safeParse(s.collected_at).success || !instant.safeParse(h.collected_at).success
      || (s.revision !== null && !revision.safeParse(s.revision).success) || (h.revision !== null && !revision.safeParse(h.revision).success)) continue;
    if (!consistent(s) || !consistent(h) || !same(s.lab_result_id, a.lab_result_id)
      || !same(s.root_id, h.root_id)
      || (same(s.lab_result_id, a.original_lab_result_id) ? s.revision !== null && s.revision !== '1' : s.revision === null || s.revision === '1')
      || (h.status === 'original' ? !same(h.effective_lab_result_id, a.original_lab_result_id) || (h.revision !== null && h.revision !== '1')
        : h.revision === null || h.revision === '1')
      || (h.status === 'cancelled' ? h.value !== null || h.effective_lab_result_id !== null
        : h.value === null || h.effective_lab_result_id === null)
      || (h.status === 'corrected' && same(h.effective_lab_result_id, a.original_lab_result_id))
      || (s.revision !== null && h.revision !== null && BigInt(s.revision) > BigInt(h.revision))) reject();
    if (e.reason === 'effective') {
      if (h.status === 'cancelled' || !same(h.effective_lab_result_id, s.lab_result_id)
        || !same(h.version_id, s.version_id) || h.revision !== s.revision || h.value !== s.value
        || micros(h.collected_at) !== micros(s.collected_at) || micros(s.collected_at) > micros(a.evaluated_at)
        || !/^\d+(?:\.\d+)?$/.test(s.value)) reject();
    } else {
      if (s.revision === null || h.revision === null || BigInt(h.revision) <= BigInt(s.revision)
        || same(h.version_id, s.version_id)
        || (e.reason === 'cancelled' ? h.status !== 'cancelled'
          : h.status === 'cancelled' || same(h.effective_lab_result_id, s.lab_result_id))) reject();
    }
  }
});
export const labEvaluationHistorySchema = z.object({
  id: z.guid(), patient_id: z.guid(), lab_result_id: z.guid(), status: labEvaluationStatusSchema,
  attempt_count: z.number().int().nonnegative(), source_assessment: labSourceAssessmentSchema.nullable(),
  lab_results: z.union([z.object({ collected_at: instant }).strict(), z.array(z.object({ collected_at: instant }).strict()).max(1)]).nullable(),
}).strict().superRefine((row, ctx) => {
  const a = row.source_assessment;
  if (!a) { if (row.status === 'invalidated') ctx.addIssue({ code: 'custom', message: 'Invalidation requires source evidence' }); return; }
  const entries = Object.values(a.analytes);
  const effective = entries.some((e) => e.reason === 'effective');
  const excluded = entries.some((e) => e.reason === 'replaced' || e.reason === 'cancelled');
  if (row.status === 'pending' || !same(a.patient_id, row.patient_id) || !same(a.lab_result_id, row.lab_result_id)
    || (row.status === 'invalidated') !== (!effective && excluded) || (row.status === 'recorded' && !effective)) {
    ctx.addIssue({ code: 'custom', message: 'Evaluation status or identity mismatch' });
  }
});
export type LabEvaluationHistory = z.infer<typeof labEvaluationHistorySchema>;
export const labEvaluationHistoryPageSchema = z.array(labEvaluationHistorySchema).max(500);
