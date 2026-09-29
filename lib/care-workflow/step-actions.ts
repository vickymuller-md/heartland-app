'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { CARE_STEP_READ_UNAVAILABLE, CARE_STEP_UNCONFIRMED, careStepInputSchema, careStepMatches,
  careStepPageSchema, careStepStateSchema, careWorkflowDetailSchema, careWorkflowReadSchema,
  type CareStepInput, type CareStepPage, type CareStepResult, type CareWorkflowDetail, type CareWorkflowRead } from './step-types';

type Operation = 'prepare' | 'read' | 'apply' | 'cancel' | 'acknowledge';
const rpcName = { read: 'get_care_step_request', apply: 'apply_care_step', cancel: 'cancel_care_step', acknowledge: 'acknowledge_care_step' } as const;
const unconfirmed: CareStepResult = { data: null, error: CARE_STEP_UNCONFIRMED };
function decode(data: unknown, input: CareStepInput) {
  const parsed = careStepStateSchema.safeParse(data);
  return parsed.success && careStepMatches(parsed.data, input) ? parsed.data : null;
}
async function stepOperation(operation: Operation, input: CareStepInput): Promise<CareStepResult> {
  if (!careStepInputSchema.safeParse(input).success) return unconfirmed;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || auth.user.id !== input.actor_id) return unconfirmed;
    if (operation === 'prepare') {
      const current = await auth.supabase.rpc('get_care_workflow_steps', { p_work_item_id: input.work_item_id });
      const detail = careWorkflowDetailSchema.safeParse(current.data);
      if (current.error || !detail.success || detail.data.work_item_id !== input.work_item_id
        || detail.data.organization_id !== input.organization_id || detail.data.patient_id !== input.patient_id) return unconfirmed;
    }
    if (operation !== 'prepare' && operation !== 'read') {
      const current = await auth.supabase.rpc('get_care_step_request', { p_request_id: input.request_id });
      if (current.error || !decode(current.data, input)) return unconfirmed;
    }
    const response = operation === 'prepare' ? await auth.supabase.rpc('prepare_care_step', {
      p_request_id: input.request_id, p_work_item_id: input.work_item_id, p_expected_revision: input.expected_revision,
      p_expected_ownership_revision: input.expected_ownership_revision, p_command: input.command, p_payload: input.payload,
    }) : await auth.supabase.rpc(rpcName[operation], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || (operation === 'apply' && saved.state !== 'applied') || (operation === 'cancel' && saved.state === 'prepared')
      || (operation === 'acknowledge' && (saved.state !== 'applied' || !saved.acknowledged_at))) return unconfirmed;
    // Cache invalidation would remount the current frozen receipt in this Next version.
    return { data: saved, error: null };
  } catch { return unconfirmed; }
}
export async function prepareCareStep(input: CareStepInput) { return stepOperation('prepare', input); }
export async function recoverCareStep(input: CareStepInput) { return stepOperation('read', input); }
export async function applyCareStep(input: CareStepInput) { return stepOperation('apply', input); }
export async function cancelCareStep(input: CareStepInput) { return stepOperation('cancel', input); }
export async function acknowledgeCareStep(input: CareStepInput) { return stepOperation('acknowledge', input); }

export async function loadCareWorkflow(input: CareWorkflowRead): Promise<{ data: CareWorkflowDetail | null; error: string | null }> {
  const invalid = { data: null, error: CARE_STEP_READ_UNAVAILABLE };
  if (!careWorkflowReadSchema.safeParse(input).success) return invalid;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || auth.user.id !== input.actor_id) return invalid;
    const { data, error } = await auth.supabase.rpc('get_care_workflow_steps', { p_work_item_id: input.work_item_id });
    const parsed = careWorkflowDetailSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.work_item_id !== input.work_item_id || parsed.data.patient_id !== input.patient_id) return invalid;
    return { data: parsed.data, error: null };
  } catch { return invalid; }
}
export async function loadPendingCareSteps(input: CareScope & { after: string | null }): Promise<{ data: CareStepPage | null; error: string | null }> {
  const invalid = { data: null, error: CARE_STEP_READ_UNAVAILABLE };
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return invalid;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || auth.user.id !== input.actor_id) return invalid;
    const { data, error } = await auth.supabase.rpc('list_pending_care_steps', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after,
    });
    const parsed = careStepPageSchema.safeParse(data);
    if (error || !parsed.success) return invalid;
    const page = parsed.data;
    let previous = input.after ?? '';
    for (const item of page.items) {
      if (item.actor_id !== input.actor_id || item.organization_id !== input.organization_id || item.patient_id !== input.patient_id
        || item.state === 'cancelled' || item.acknowledged_at !== null || item.request_id <= previous) return invalid;
      previous = item.request_id;
    }
    if (page.next_cursor && (page.items.length !== 25 || page.next_cursor !== previous)) return invalid;
    return { data: page, error: null };
  } catch { return invalid; }
}
