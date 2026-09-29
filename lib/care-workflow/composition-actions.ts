'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { compositionDetailSchema, compositionInputSchema, compositionInvalidationPageSchema, compositionMatches,
  compositionPendingPageSchema, compositionRoutingPageSchema, compositionStateSchema,
  type CompositionDetail, type CompositionInput, type CompositionState } from './composition-types';

type Result = { data: CompositionState; error: null } | { data: null; error: string };
const failure = { data: null, error: 'The source association could not be verified. Keep the exact request and recover its state; do not replace its identity, payload or revisions.' } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const rpc = { read: 'get_care_lab_composition_request', apply: 'apply_care_lab_composition',
  cancel: 'cancel_care_lab_composition', acknowledge: 'acknowledge_care_lab_composition' } as const;
function decode(value: unknown, input: CompositionInput) {
  const parsed = compositionStateSchema.safeParse(value);
  return parsed.success && compositionMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | keyof typeof rpc, input: CompositionInput): Promise<Result> {
  if (!compositionInputSchema.safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    if (name !== 'read') {
      const response = await auth.supabase.rpc(rpc.read, { p_request_id: input.request_id });
      if (!response.error) {
        const saved = decode(response.data, input);
        if (!saved) return failure;
        if (name === 'prepare') return { data: saved, error: null };
      } else if (name !== 'prepare') return failure;
    }
    const response = name === 'prepare' ? await auth.supabase.rpc('prepare_care_lab_composition', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_organization_id: input.organization_id,
      p_patient_id: input.patient_id, p_expected_revision: input.expected_revision,
      p_expected_ownership_revision: input.expected_ownership_revision, p_payload: input.payload,
    }) : await auth.supabase.rpc(rpc[name], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || name === 'apply' && saved.state !== 'applied' || name === 'cancel' && saved.state === 'prepared'
      || name === 'acknowledge' && (saved.state !== 'applied' || saved.acknowledged_at === null)) return failure;
    return { data: saved, error: null };
  } catch { return failure; }
}
export async function prepareComposition(input: CompositionInput) { return operation('prepare', input); }
export async function recoverComposition(input: CompositionInput) { return operation('read', input); }
export async function applyComposition(input: CompositionInput) { return operation('apply', input); }
export async function cancelComposition(input: CompositionInput) { return operation('cancel', input); }
export async function acknowledgeComposition(input: CompositionInput) { return operation('acknowledge', input); }

const readSchema = careScopeSchema.extend({ work_item_id: z.guid() }).strict();
type Read = CareScope & { work_item_id: string };
export async function loadCompositionDetail(input: Read): Promise<{ data: CompositionDetail | null; error: string | null }> {
  if (!readSchema.safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('get_care_lab_composition', { p_work_item_id: input.work_item_id });
    const result = compositionDetailSchema.safeParse(response.data);
    if (response.error || !result.success || !(['actor_id', 'organization_id', 'patient_id', 'work_item_id'] as const)
      .every((key) => same(result.data[key], input[key]))) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
export async function loadPendingCompositions(input: CareScope & { after: string | null }): Promise<{ data: z.infer<typeof compositionPendingPageSchema> | null; error: string | null }> {
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('list_pending_care_lab_compositions', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const result = compositionPendingPageSchema.safeParse(response.data);
    if (response.error || !result.success || result.data.items.some((item) =>
      !(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(item[key], input[key]))
      || input.after !== null && item.request_id.toLowerCase() <= input.after.toLowerCase())) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
async function readWorkPage<T extends z.ZodType<{ work_item_id: string; items: unknown[]; next_cursor: string | null }>>(
  input: Read & { after: string | null }, name: string, schema: T,
): Promise<{ data: z.infer<T> | null; error: string | null }> {
  if (!readSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const scoped = await auth.supabase.rpc('get_care_workflow', { p_work_item_id: input.work_item_id });
    const identity = z.object({ work_item_id: z.guid(), patient_id: z.guid(), organization_id: z.guid() }).safeParse(scoped.data);
    if (scoped.error || !identity.success || !(['work_item_id', 'organization_id', 'patient_id'] as const).every((key) => same(identity.data[key], input[key]))) return failure;
    const response = await auth.supabase.rpc(name, { p_work_item_id: input.work_item_id, p_after: input.after });
    const result = schema.safeParse(response.data);
    if (response.error || !result.success || !same(result.data.work_item_id, input.work_item_id)) return failure;
    for (const row of result.data.items) {
      const id = z.object({ id: z.guid() }).safeParse(row);
      const intent = z.object({ intent_id: z.guid() }).safeParse(row);
      const key = id.success ? id.data.id : intent.success ? intent.data.intent_id : null;
      if (key === null || input.after !== null && key.toLowerCase() <= input.after.toLowerCase()) return failure;
    }
    return { data: result.data, error: null };
  } catch { return failure; }
}
export async function loadCompositionIntentions(input: Read & { after: string | null }) {
  return readWorkPage(input, 'list_care_lab_intentions', compositionRoutingPageSchema);
}
export async function loadCompositionInvalidations(input: Read & { after: string | null }) {
  return readWorkPage(input, 'list_care_lab_invalidations', compositionInvalidationPageSchema);
}
