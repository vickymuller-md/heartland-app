'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { humanContextSchema, humanInputSchema, humanMatches, humanPendingPageSchema, humanStateSchema, humanCommandNameSchema,
  type HumanContext, type HumanInput, type HumanState } from './human-types';

type Result = { data: HumanState; error: null } | { data: null; error: string };
const failure = { data: null, error: 'The human record could not be verified. Recover the exact request; do not replace its identity, evidence or revisions.' } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const rpc = { read: 'get_care_human_request', apply: 'apply_care_human_request',
  cancel: 'cancel_care_human_request', acknowledge: 'acknowledge_care_human_request' } as const;
function decode(value: unknown, input: HumanInput) {
  const parsed = humanStateSchema.safeParse(value);
  return parsed.success && humanMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | keyof typeof rpc, input: HumanInput): Promise<Result> {
  if (!humanInputSchema.safeParse(input).success) return failure;
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
    const response = name === 'prepare' ? await auth.supabase.rpc('prepare_care_human_request', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_organization_id: input.organization_id,
      p_patient_id: input.patient_id, p_expected_revision: input.expected_revision,
      p_expected_ownership_revision: input.expected_ownership_revision, p_command: input.command,
      p_basis: input.basis, p_basis_signature: input.basis_signature, p_payload: input.payload,
    }) : await auth.supabase.rpc(rpc[name], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || name === 'apply' && saved.state !== 'applied' || name === 'cancel' && saved.state === 'prepared'
      || name === 'acknowledge' && (saved.state !== 'applied' || saved.acknowledged_at === null)) return failure;
    return { data: saved, error: null };
  } catch { return failure; }
}
export async function prepareHuman(input: HumanInput) { return operation('prepare', input); }
export async function recoverHuman(input: HumanInput) { return operation('read', input); }
export async function applyHuman(input: HumanInput) { return operation('apply', input); }
export async function cancelHuman(input: HumanInput) { return operation('cancel', input); }
export async function acknowledgeHuman(input: HumanInput) { return operation('acknowledge', input); }

const readSchema = careScopeSchema.extend({ work_item_id: z.guid(), command: humanCommandNameSchema }).strict();
export async function loadHumanContext(input: z.infer<typeof readSchema>): Promise<{ data: HumanContext | null; error: string | null }> {
  if (!readSchema.safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('get_care_human_context', { p_work_item_id: input.work_item_id, p_command: input.command });
    const result = humanContextSchema.safeParse(response.data);
    if (response.error || !result.success || result.data.command !== input.command || !(['actor_id', 'organization_id', 'patient_id', 'work_item_id'] as const)
      .every((key) => same(result.data[key], input[key]))) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
export async function loadPendingHuman(input: CareScope & { after: string | null }): Promise<{ data: z.infer<typeof humanPendingPageSchema> | null; error: string | null }> {
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('list_pending_care_human_requests', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const result = humanPendingPageSchema.safeParse(response.data);
    if (response.error || !result.success || result.data.items.some((item) =>
      !(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(item[key], input[key]))
      || input.after !== null && item.request_id.toLowerCase() <= input.after.toLowerCase())) return failure;
    return { data: result.data, error: null };
  } catch { return failure; }
}
