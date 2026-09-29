import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { labEvaluationStatusSchema } from '@/lib/labs/evaluation';
import { careAnalyteSchema } from '@/lib/care-workflow/types';

const guid = z.guid();
const instant = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const revision = z.string().regex(/^[1-9]\d{0,18}$/).refine((value) => /^[1-9]\d{0,18}$/.test(value)
  && BigInt(value) <= BigInt('9223372036854775807'));
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const effectiveLabObservationSchema = z.object({
  id: z.string(), patient_id: guid, original_lab_result_id: guid, analyte: careAnalyteSchema,
  root_id: guid.nullable(), version_id: guid.nullable(), revision: revision.nullable(),
  status: z.enum(['original', 'corrected', 'cancelled']), effective_lab_result_id: guid.nullable(),
  // Unexpected/nonfinite source encoding fails the whole read, never drops one observation.
  value: z.string().regex(/^-?\d+(?:\.\d+)?$/).nullable(), collected_at: instant,
  notes: z.string().nullable(), lab_facility: z.string().nullable(),
  evaluation_status: labEvaluationStatusSchema.nullable(),
}).strict().superRefine((value, ctx) => {
  const registered = value.root_id !== null;
  if (value.id !== `${value.original_lab_result_id.toLowerCase()}:${value.analyte}`
    || registered !== (value.version_id !== null) || registered !== (value.revision !== null)
    || (value.status !== 'original' && !registered)
    || (value.status === 'original' && (value.revision !== null && value.revision !== '1'))
    || (value.status !== 'original' && value.revision === '1')
    || (value.status === 'original' && (value.effective_lab_result_id === null
      || !sameId(value.effective_lab_result_id, value.original_lab_result_id)))
    || (value.status === 'corrected' && (value.effective_lab_result_id === null
      || sameId(value.effective_lab_result_id, value.original_lab_result_id)))
    || (value.status === 'cancelled'
      ? value.value !== null || value.effective_lab_result_id !== null || value.evaluation_status !== null
      : value.value === null || value.effective_lab_result_id === null)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent observation identity or version.' });
  }
});
const pageSchema = z.object({
  actor_id: guid, patient_ids: z.array(guid).min(1).max(500), snapshot: z.string().regex(/^[0-9a-f]{64}$/),
  items: z.array(effectiveLabObservationSchema).max(250), next_cursor: z.string().nullable(),
}).strict();
export type EffectiveLabObservation = z.infer<typeof effectiveLabObservationSchema>;
export const EFFECTIVE_LABS_UNAVAILABLE = 'Current laboratory results could not be verified. Reload the complete source view before using these values.';

/** Current authorization and a whole-composition signature are checked for every page.
 * No partial return, silent retry, or raw-table fallback. Caller must fence late UI responses
 * against logout/account/patient changes using the expected actor supplied here.
 */
export async function getEffectiveLabObservations(
  supabase: SupabaseClient, patientIds: string[], expectedActorId: string,
): Promise<EffectiveLabObservation[]> {
  if (!guid.safeParse(expectedActorId).success || !z.array(guid).max(500).safeParse(patientIds).success) {
    throw new Error(EFFECTIVE_LABS_UNAVAILABLE);
  }
  const scope = [...new Set(patientIds.map((id) => id.toLowerCase()))].sort();
  if (scope.length === 0) return [];
  let cursor: string | null = null;
  let snapshot: string | null = null;
  const observations: EffectiveLabObservation[] = [];
  try {
    for (;;) {
      const { data, error } = await supabase.rpc('get_effective_lab_observations', {
        p_patient_ids: scope, p_after: cursor, p_snapshot: snapshot,
      });
      if (error) throw error;
      const page = pageSchema.parse(data);
      if (!sameId(page.actor_id, expectedActorId) || JSON.stringify(page.patient_ids) !== JSON.stringify(scope)
        || (snapshot !== null && page.snapshot !== snapshot)) throw new Error('Projection scope or snapshot mismatch');
      let last: string | null = cursor;
      for (const item of page.items) {
        if (!scope.includes(item.patient_id.toLowerCase()) || (last !== null && item.id <= last)) {
          throw new Error('Projection identity or ordering mismatch');
        }
        last = item.id;
      }
      if (page.next_cursor !== null && (page.items.length !== 250 || page.next_cursor !== last || page.next_cursor === cursor)) {
        throw new Error('Projection cursor did not advance');
      }
      observations.push(...page.items);
      if (page.next_cursor === null) return observations;
      cursor = page.next_cursor;
      snapshot = page.snapshot;
    }
  } catch {
    throw new Error(EFFECTIVE_LABS_UNAVAILABLE);
  }
}

function micros(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3));
}
function canonicalDecimal(value: string): string {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const normalized = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
  return negative && normalized !== '0.' ? `-${normalized}` : normalized;
}
export type LatestEffectiveLab = { state: 'missing'; observation: null; reason: string }
  | { state: 'available' | 'invalid' | 'cancelled'; observation: EffectiveLabObservation; reason: string };

/** Data selection only, not a reference range, recency rule or clinical suitability claim. */
export function selectLatestEffectiveLab(
  observations: EffectiveLabObservation[], patientId: string,
  analyte: z.infer<typeof careAnalyteSchema>, now = new Date(),
): LatestEffectiveLab {
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid laboratory selection time');
  const candidates = observations.filter((item) => sameId(item.patient_id, patientId) && item.analyte === analyte);
  if (candidates.length === 0) return { state: 'missing', observation: null, reason: 'No recorded source for this analyte.' };
  const invalidTime = candidates.find((item) => !instant.safeParse(item.collected_at).success);
  if (invalidTime) return { state: 'invalid', observation: invalidTime, reason: 'Invalid collection time; verify the source.' };
  candidates.sort((a, b) => micros(a.collected_at) === micros(b.collected_at) ? a.id.localeCompare(b.id)
    : micros(a.collected_at) > micros(b.collected_at) ? -1 : 1);
  const latest = candidates[0];
  if (micros(latest.collected_at) > BigInt(now.getTime()) * BigInt(1000)) {
    return { state: 'invalid', observation: latest, reason: 'Future collection time; verify the source.' };
  }
  const sameTime = candidates.filter((item) => micros(item.collected_at) === micros(latest.collected_at));
  const cancelled = sameTime.find((item) => item.status === 'cancelled');
  if (cancelled) return { state: 'cancelled', observation: cancelled,
    reason: 'A source at the latest collection time was cancelled. Reconcile it; no older value was substituted.' };
  const invalidValue = sameTime.find((item) => item.value === null || !/^-?\d+(?:\.\d+)?$/.test(item.value)
    || canonicalDecimal(item.value).startsWith('-'));
  if (invalidValue) return { state: 'invalid', observation: invalidValue, reason: 'Invalid recorded value; verify the source.' };
  if (sameTime.some((item) => canonicalDecimal(item.value!) !== canonicalDecimal(latest.value!))) {
    return { state: 'invalid', observation: latest, reason: 'Conflicting current sources at the same collection time; reconcile them.' };
  }
  return { state: 'available', observation: latest, reason: 'Recorded value available; recency and clinical suitability are not assessed.' };
}
