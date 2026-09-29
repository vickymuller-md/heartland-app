'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { CARE_READ_UNAVAILABLE, CARE_UNCONFIRMED, careRequestInputSchema, careRequestMatches,
  careRequestPageSchema, careRequestStateSchema, careScopeSchema,
  type CareRequestInput, type CareRequestPage, type CareRequestResult, type CareScope } from './types';

const unconfirmed: CareRequestResult = { data: null, error: CARE_UNCONFIRMED };
type Operation = 'prepare' | 'read' | 'apply' | 'cancel' | 'acknowledge';
const operationRpc = {
  read: 'get_care_workflow_request', apply: 'apply_care_workflow_request',
  cancel: 'cancel_care_workflow_request', acknowledge: 'acknowledge_care_workflow_request',
} as const;

function decode(data: unknown, input: CareRequestInput) {
  const parsed = careRequestStateSchema.safeParse(data);
  return parsed.success && careRequestMatches(parsed.data, input) ? parsed.data : null;
}

async function requestOperation(operation: Operation, input: CareRequestInput): Promise<CareRequestResult> {
  if (!careRequestInputSchema.safeParse(input).success) return unconfirmed;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || auth.user.id !== input.actor_id) return unconfirmed;
    // Before a state-changing operation, verify the full frozen identity, not just its UUID.
    if (operation !== 'prepare' && operation !== 'read') {
      const current = await auth.supabase.rpc('get_care_workflow_request', { p_request_id: input.request_id });
      if (current.error || !decode(current.data, input)) return unconfirmed;
    }
    const response = operation === 'prepare'
      ? await auth.supabase.rpc('prepare_care_workflow_request', {
        p_request_id: input.request_id, p_work_item_id: input.work_item_id,
        p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_payload: input.payload,
      }) : await auth.supabase.rpc(operationRpc[operation], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || (operation === 'apply' && saved.state !== 'applied')
      || (operation === 'cancel' && saved.state === 'prepared')
      || (operation === 'acknowledge' && (saved.state !== 'applied' || !saved.acknowledged_at))) return unconfirmed;
    // In this Next version even revalidating another path refreshes the current
    // page. Keep the frozen receipt mounted; the UI uses full navigation to the queue.
    return { data: saved, error: null };
  } catch { return unconfirmed; }
}

export async function prepareCareRequest(input: CareRequestInput) { return requestOperation('prepare', input); }
export async function recoverCareRequest(input: CareRequestInput) { return requestOperation('read', input); }
export async function applyCareRequest(input: CareRequestInput) { return requestOperation('apply', input); }
export async function cancelCareRequest(input: CareRequestInput) { return requestOperation('cancel', input); }
export async function acknowledgeCareRequest(input: CareRequestInput) { return requestOperation('acknowledge', input); }

export async function loadPendingCareRequests(input: CareScope & { after: string | null }): Promise<{
  data: CareRequestPage | null; error: string | null;
}> {
  const invalid = { data: null, error: CARE_READ_UNAVAILABLE };
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return invalid;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || auth.user.id !== input.actor_id) return invalid;
    const { data, error } = await auth.supabase.rpc('list_pending_care_requests', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after,
    });
    const parsed = careRequestPageSchema.safeParse(data);
    if (error || !parsed.success) return invalid;
    const page = parsed.data;
    let previous = input.after ?? '';
    for (const item of page.items) {
      if (item.actor_id !== input.actor_id || item.organization_id !== input.organization_id
        || item.patient_id !== input.patient_id || item.state === 'cancelled' || item.acknowledged_at !== null
        || item.request_id <= previous) return invalid;
      previous = item.request_id;
    }
    if (page.next_cursor && (page.items.length !== 25 || page.next_cursor !== previous)) return invalid;
    return { data: page, error: null };
  } catch { return invalid; }
}
