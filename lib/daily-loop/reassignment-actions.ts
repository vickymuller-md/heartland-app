'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { reassignmentContextSchema, reassignmentStateSchema, reassignmentPageSchema, REASSIGNMENT_UNAVAILABLE,
  type ReassignmentContext, type ReassignmentState, type ReassignmentPage } from './reassignment';

export async function loadWorkReassignmentContext(input: { workItemId: string; after: string | null }): Promise<{
  data: ReassignmentContext | null; error: string | null; recovery?: ReassignmentState;
}> {
  const request = z.object({ workItemId: z.uuid(), after: z.uuid().nullable() }).strict().safeParse(input);
  if (!request.success) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    const saved = await auth.supabase.rpc('recover_work_reassignment', { p_work_item_id: request.data.workItemId });
    if (saved.error) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    if (saved.data !== null) {
      const recovery = reassignmentStateSchema.safeParse(saved.data);
      if (!recovery.success || recovery.data.request.workItemId !== request.data.workItemId) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
      return { data: null, recovery: recovery.data, error: null };
    }
    const { data, error } = await auth.supabase.rpc('get_work_reassignment_context', {
      p_work_item_id: request.data.workItemId, p_after: request.data.after, p_limit: 25,
    });
    const parsed = reassignmentContextSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.work_item_id !== input.workItemId) {
      return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    }
    return { data: parsed.data, error: null };
  } catch {
    return { data: null, error: REASSIGNMENT_UNAVAILABLE };
  }
}

export async function finishWorkReassignment(input: { requestId: string; receiptId: string | null; cancel: boolean }): Promise<{
  data: ReassignmentState | null; error: string | null;
}> {
  const parsed = z.object({ requestId: z.uuid(), receiptId: z.uuid().nullable(), cancel: z.boolean() }).strict()
    .refine((value) => value.cancel ? value.receiptId === null : value.receiptId !== null).safeParse(input);
  if (!parsed.success) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    const response = await auth.supabase.rpc('finish_work_reassignment_request', {
      p_request_id: parsed.data.requestId, p_receipt_id: parsed.data.receiptId, p_cancel: parsed.data.cancel,
    });
    const state = reassignmentStateSchema.safeParse(response.data);
    if (response.error || !state.success || state.data.request.requestId !== parsed.data.requestId
      || (parsed.data.cancel ? !['cancelled', 'applied', 'seen'].includes(state.data.state)
        : state.data.state !== 'seen' || state.data.receipt?.event_id !== parsed.data.receiptId)) {
      return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    }
    return { data: state.data, error: null };
  } catch { return { data: null, error: REASSIGNMENT_UNAVAILABLE }; }
}

export async function loadMyReassignmentRequests(after: string | null = null): Promise<{ data: ReassignmentPage | null; error: string | null }> {
  if (!z.uuid().nullable().safeParse(after).success) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    const response = await auth.supabase.rpc('get_my_work_reassignment_requests', { p_after: after, p_limit: 25 });
    const page = reassignmentPageSchema.safeParse(response.data);
    if (response.error || !page.success) return { data: null, error: REASSIGNMENT_UNAVAILABLE };
    return { data: page.data, error: null };
  } catch { return { data: null, error: REASSIGNMENT_UNAVAILABLE }; }
}
