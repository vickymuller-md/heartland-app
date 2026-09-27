'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { transferContextSchema, designationContextSchema, OWNERSHIP_CONTEXT_UNAVAILABLE,
  type TransferContext, type DesignationContext } from './ownership-context';

export async function loadTransferContext(input: { workItemId: string; after: string | null }): Promise<{ data: TransferContext | null; error: string | null }> {
  const parsed = z.object({ workItemId: z.uuid(), after: z.uuid().nullable() }).strict().safeParse(input);
  if (!parsed.success) return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
    const response = await auth.supabase.rpc('get_work_transfer_context', { p_work_item_id: parsed.data.workItemId, p_after: parsed.data.after, p_limit: 25 });
    const data = transferContextSchema.safeParse(response.data);
    if (response.error || !data.success || data.data.work_item_id !== parsed.data.workItemId) return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
    return { data: data.data, error: null };
  } catch { return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE }; }
}

export async function loadDesignationContext(input: { organizationId: string; patientId: string; after: string | null }): Promise<{ data: DesignationContext | null; error: string | null }> {
  const parsed = z.object({ organizationId: z.uuid(), patientId: z.uuid(), after: z.uuid().nullable() }).strict().safeParse(input);
  if (!parsed.success) return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
    const response = await auth.supabase.rpc('get_patient_designation_context', { p_organization_id: parsed.data.organizationId,
      p_patient_id: parsed.data.patientId, p_after: parsed.data.after, p_limit: 25 });
    const data = designationContextSchema.safeParse(response.data);
    if (response.error || !data.success || data.data.organization_id !== parsed.data.organizationId || data.data.patient_id !== parsed.data.patientId) {
      return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE };
    }
    return { data: data.data, error: null };
  } catch { return { data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE }; }
}
