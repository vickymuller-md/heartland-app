import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { careScopeSchema, type CareScope } from '@/lib/care-workflow/types';
import { effectiveLabObservationSchema } from './effective';
import { observationInputSchema, type ObservationInput } from './observation-types';
import { labCollectionMicros } from './quality';

const item = z.object({ observation: effectiveLabObservationSchema,
  source_authority_organization_id: z.guid().nullable() }).strict().refine((value) =>
  (value.observation.root_id === null) === (value.source_authority_organization_id === null));
const page = careScopeSchema.extend({ can_mutate: z.boolean(), snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(item).max(250), next_cursor: z.string().nullable() }).strict();
export type LabSourceItem = z.infer<typeof item>;
export type LabSourceContext = CareScope & { can_mutate: boolean; items: LabSourceItem[] };
export const SOURCE_CONTEXT_UNAVAILABLE = 'The complete source context could not be verified. New source commands remain unavailable; you may check your own saved requests separately.';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function getLabSourceContext(client: SupabaseClient, scope: CareScope): Promise<LabSourceContext> {
  if (!careScopeSchema.safeParse(scope).success) throw new Error(SOURCE_CONTEXT_UNAVAILABLE);
  const items: LabSourceItem[] = []; let cursor: string | null = null; let signature: string | null = null;
  let capability: boolean | null = null;
  try {
    for (;;) {
      const { data, error } = await client.rpc('get_lab_source_context', { p_organization_id: scope.organization_id,
        p_patient_id: scope.patient_id, p_after: cursor, p_snapshot: signature });
      if (error) throw error;
      const p = page.parse(data);
      if (!(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(p[key], scope[key]))
        || (signature !== null && p.snapshot !== signature) || (capability !== null && p.can_mutate !== capability)) throw new Error('Context changed');
      let previous: string | null = cursor;
      for (const row of p.items) {
        if (!same(row.observation.patient_id, scope.patient_id) || (previous !== null && row.observation.id <= previous)) throw new Error('Invalid source order or scope');
        previous = row.observation.id;
      }
      if (p.next_cursor !== null && (p.items.length !== 250 || p.next_cursor !== previous || p.next_cursor === cursor)) throw new Error('Incomplete source page');
      items.push(...p.items);
      if (p.next_cursor === null) return { ...scope, can_mutate: p.can_mutate, items };
      cursor = p.next_cursor; signature = p.snapshot; capability = p.can_mutate;
    }
  } catch { throw new Error(SOURCE_CONTEXT_UNAVAILABLE); }
}

/** Current read affordance only. SQL independently rechecks authority/CAS at application. */
export function canChangeLabSource(context: LabSourceContext, source: LabSourceItem): boolean {
  return context.can_mutate && same(source.observation.patient_id, context.patient_id)
    && (source.source_authority_organization_id === null || same(source.source_authority_organization_id, context.organization_id));
}

/** Same technical source requirements as the registration snapshot, not recency. */
export function canRegisterLabSource(source: LabSourceItem, now = Date.now()): boolean {
  const parsed = item.safeParse(source);
  if (!parsed.success || !Number.isFinite(now)) return false;
  const o = parsed.data.observation; const collected = labCollectionMicros(o.collected_at);
  return o.root_id === null && o.status === 'original' && o.value !== null
    && /^\d+(?:\.\d+)?$/.test(o.value) && collected !== null && collected <= BigInt(Math.trunc(now)) * BigInt(1000);
}

/** Storage precision from migration00011, not clinical reference intervals. */
export function validateSourceDraft(input: unknown, now = Date.now()): ObservationInput | null {
  const parsed = observationInputSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now)) return null;
  const value = parsed.data; const cutoff = BigInt(Math.trunc(now)) * BigInt(1000);
  const occurred = labCollectionMicros(value.payload.occurred_at);
  if (occurred === null || occurred > cutoff) return null;
  if (value.command === 'correct_source') {
    const at = labCollectionMicros(value.payload.collected_at);
    if (at === null || at > cutoff) return null;
    const [rawWhole, rawFraction = ''] = value.payload.value.split('.');
    const whole = rawWhole.replace(/^0+(?=\d)/, ''); const fraction = rawFraction.replace(/0+$/, '');
    const sizes = { potassium: [2, 1], creatinine: [2, 2], bun: [3, 1], bnp: [6, 1], nt_probnp: [7, 1],
      hba1c: [2, 1], glucose: [4, 1], sodium: [3, 1], hemoglobin: [3, 1], ferritin: [5, 1], tsat: [3, 1], ldl: [4, 1] } as const;
    if (value.analyte === 'egfr') { if (fraction.length || BigInt(whole) > BigInt('2147483647')) return null; }
    else { const [digits, decimals] = sizes[value.analyte]; if (whole.length > digits || fraction.length > decimals) return null; }
  }
  return value;
}
