'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { unsavedContextSchema, unsavedInputSchema, unsavedMatches, unsavedPendingPageSchema, unsavedStateSchema,
  unsavedHistoryPageSchema, type UnsavedInput, type UnsavedState, type UnsavedContext } from './unsaved-intent-types';

type Result = { data: UnsavedState; error: null } | { data: null; error: string };
const failure = { data: null, error: 'The administrative request could not be verified. Recover its exact identity, target, evidence and revisions; do not create a replacement.' } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const rpc = { read: 'get_care_unsaved_intent_request', apply: 'apply_care_unsaved_intent_request',
  cancel: 'cancel_care_unsaved_intent_request', acknowledge: 'acknowledge_care_unsaved_intent_request' } as const;
function decode(value: unknown, input: UnsavedInput) {
  const parsed = unsavedStateSchema.safeParse(value);
  return parsed.success && unsavedMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | keyof typeof rpc, input: UnsavedInput): Promise<Result> {
  if (!unsavedInputSchema.safeParse(input).success) return failure;
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
    const response = name === 'prepare' ? await auth.supabase.rpc('prepare_care_unsaved_intent_request', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_intent_id: input.intent_id,
      p_organization_id: input.organization_id, p_patient_id: input.patient_id,
      p_expected_revision: input.expected_revision, p_expected_ownership_revision: input.expected_ownership_revision, p_payload: input.payload,
    }) : await auth.supabase.rpc(rpc[name], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || name === 'apply' && saved.state !== 'applied' || name === 'cancel' && saved.state === 'prepared'
      || name === 'acknowledge' && (saved.state !== 'applied' || saved.acknowledged_at === null)) return failure;
    return { data: saved, error: null };
  } catch { return failure; }
}
export async function prepareUnsaved(input: UnsavedInput) { return operation('prepare', input); }
export async function recoverUnsaved(input: UnsavedInput) { return operation('read', input); }
export async function applyUnsaved(input: UnsavedInput) { return operation('apply', input); }
export async function cancelUnsaved(input: UnsavedInput) { return operation('cancel', input); }
export async function acknowledgeUnsaved(input: UnsavedInput) { return operation('acknowledge', input); }

const readSchema = careScopeSchema.extend({ work_item_id: z.guid() }).strict();
const contextInput = readSchema.extend({ intent_id: z.guid() }).strict();
export async function loadUnsavedContext(input: z.infer<typeof contextInput>): Promise<{ data: UnsavedContext | null; error: string | null }> {
  if (!contextInput.safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('get_care_unsaved_intent_context', { p_work_item_id: input.work_item_id, p_intent_id: input.intent_id });
    const result = unsavedContextSchema.safeParse(response.data);
    if (response.error || !result.success || !same(result.data.snapshot.intent_id, input.intent_id)
      || !(['actor_id', 'organization_id', 'patient_id', 'work_item_id'] as const).every((key) => same(result.data[key], input[key]))) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
export async function loadPendingUnsaved(input: CareScope & { after: string | null }): Promise<{ data: z.infer<typeof unsavedPendingPageSchema> | null; error: string | null }> {
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('list_pending_care_unsaved_intent_requests', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const result = unsavedPendingPageSchema.safeParse(response.data);
    if (response.error || !result.success || result.data.items.some((item) =>
      !(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(item[key], input[key]))
      || input.after !== null && item.request_id.toLowerCase() <= input.after.toLowerCase())) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
export async function loadUnsavedHistory(input: CareScope & { work_item_id: string; after: string | null }): Promise<{ data: z.infer<typeof unsavedHistoryPageSchema> | null; error: string | null }> {
  if (!readSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const scoped = await auth.supabase.rpc('get_care_workflow', { p_work_item_id: input.work_item_id });
    const identity = z.object({ work_item_id: z.guid(), patient_id: z.guid(), organization_id: z.guid() }).safeParse(scoped.data);
    if (scoped.error || !identity.success || !(['work_item_id', 'organization_id', 'patient_id'] as const).every((key) => same(identity.data[key], input[key]))) return failure;
    const response = await auth.supabase.rpc('list_care_unsaved_intent_history', { p_work_item_id: input.work_item_id, p_after: input.after });
    const result = unsavedHistoryPageSchema.safeParse(response.data);
    if (response.error || !result.success || !same(result.data.work_item_id, input.work_item_id)
      || result.data.items.some((row) => input.after !== null && row.event_id.toLowerCase() <= input.after.toLowerCase())) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
