'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { MANAGER_OUTCOME_CODE, PROVIDER_OUTCOME_CODES } from './types';

/**
 * Outcome codes a human may choose. `followup_completed`, `followup_skipped` and
 * `outcome_not_recorded` are written by the database only and are never offered here.
 */
const outcomeCodeSchema = z.enum([...PROVIDER_OUTCOME_CODES, MANAGER_OUTCOME_CODE]);

const transitionSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
  status: z.enum(['reviewed', 'actioned', 'awaiting', 'closed']),
  outcome: z.string().trim().min(3).max(1000).optional(),
  outcomeCode: outcomeCodeSchema.optional(),
  snoozeReason: z.string().trim().min(3).max(500).optional(),
  dueAt: z.iso.datetime().optional(),
}).superRefine((value, context) => {
  if (value.status === 'closed' && !value.outcome) {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'Outcome is required' });
  }
  if (value.status === 'actioned' && !value.outcome) {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'Document the action taken' });
  }
  if (value.status === 'awaiting' && (!value.snoozeReason || !value.dueAt)) {
    context.addIssue({ code: 'custom', path: ['snoozeReason'], message: 'Reason and due date are required' });
  }
  if (value.status === 'awaiting' && value.dueAt && new Date(value.dueAt) <= new Date()) {
    context.addIssue({ code: 'custom', path: ['dueAt'], message: 'Due date must be in the future' });
  }
});

export type WorkItemTransitionInput = z.infer<typeof transitionSchema>;

export async function transitionWorkItem(
  input: WorkItemTransitionInput,
): Promise<{ success: boolean; error?: string }> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid update' };
  }

  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  if (parsed.data.status === 'closed' && !parsed.data.outcomeCode) {
    // Items created under the single-accountable model require a documented outcome code.
    // Items created before it (`accountability_source` NULL) still close with text only.
    const { data: item, error: itemError } = await auth.supabase
      .from('work_items')
      .select('accountability_source')
      .eq('id', parsed.data.workItemId)
      .eq('patient_id', parsed.data.patientId)
      .maybeSingle();
    if (itemError || !item) {
      return { success: false, error: 'Unable to update this work item' };
    }
    if (item.accountability_source) {
      return { success: false, error: 'Choose a documented outcome code to close this item' };
    }
  }

  const update: Record<string, string | null> = { status: parsed.data.status };
  if (parsed.data.status === 'closed' || parsed.data.status === 'actioned') {
    update.outcome = parsed.data.outcome ?? null;
    if (parsed.data.outcomeCode) update.outcome_code = parsed.data.outcomeCode;
  }
  if (parsed.data.status === 'awaiting') {
    update.snooze_reason = parsed.data.snoozeReason ?? null;
    update.due_at = parsed.data.dueAt ?? null;
  }

  const { data, error } = await auth.supabase
    .from('work_items')
    .update(update)
    .eq('id', parsed.data.workItemId)
    .eq('patient_id', parsed.data.patientId)
    .select('id');

  if (error || !data?.length) {
    return { success: false, error: 'Unable to update this work item' };
  }

  const eventMap = {
    reviewed: 'work_item_reviewed',
    actioned: 'work_item_actioned',
    awaiting: 'work_item_awaiting',
    closed: 'work_item_closed',
  } as const;
  await trackProductEvent({ eventName: eventMap[parsed.data.status], area: 'provider_home' });

  revalidatePath('/dashboard');
  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}

const bulkReviewSchema = z.array(z.uuid()).min(1).max(50);

export async function bulkReviewWorkItems(
  workItemIds: string[],
): Promise<{ success: boolean; updated?: number; error?: string }> {
  const parsed = bulkReviewSchema.safeParse([...new Set(workItemIds)]);
  if (!parsed.success) return { success: false, error: 'Select between 1 and 50 eligible items.' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('work_items')
    .update({ status: 'reviewed' })
    .in('id', parsed.data)
    .eq('assigned_to', auth.user.id)
    .in('status', ['new', 'due'])
    .select('id');
  if (error) return { success: false, error: 'Selected work could not be reviewed.' };

  revalidatePath('/dashboard');
  return { success: true, updated: data?.length ?? 0 };
}

const manualWorkItemSchema = z.object({
  patientId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  reason: z.string().trim().min(3).max(1000),
  priority: z.enum(['now', 'today', 'week', 'watching']),
  severity: z.enum(['critical', 'warning', 'informational']),
  dueAt: z.iso.datetime(),
});

export interface CreateWorkItemState {
  success?: boolean;
  error?: string;
}

export async function createManualWorkItem(
  _state: CreateWorkItemState | null,
  formData: FormData,
): Promise<CreateWorkItemState> {
  const rawDueAt = String(formData.get('dueAt') ?? '');
  const dueDate = rawDueAt ? new Date(rawDueAt) : null;
  if (dueDate && Number.isNaN(dueDate.getTime())) return { error: 'Invalid due date' };
  const parsed = manualWorkItemSchema.safeParse({
    patientId: formData.get('patientId'),
    title: formData.get('title'),
    reason: formData.get('reason'),
    priority: formData.get('priority'),
    severity: formData.get('severity'),
    dueAt: dueDate?.toISOString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid work item' };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { error: auth.error };

  const { error } = await auth.supabase.from('work_items').insert({
    patient_id: parsed.data.patientId,
    provider_id: auth.user.id,
    assigned_to: auth.user.id,
    source_type: 'manual',
    title: parsed.data.title,
    reason: parsed.data.reason,
    priority: parsed.data.priority,
    severity: parsed.data.severity,
    due_at: parsed.data.dueAt,
    freshness_at: new Date().toISOString(),
    data_quality: 'verified',
  });

  if (error) return { error: 'Unable to create follow-up work' };
  revalidatePath('/dashboard');
  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}

const assignmentSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
  assigneeId: z.uuid(),
  note: z.string().trim().min(3).max(500).optional(),
});

function revalidateWorkSurfaces(patientId: string): void {
  revalidatePath('/dashboard');
  revalidatePath('/team');
  revalidatePath(`/patients/${patientId}`);
}

/**
 * Offers the item to another team member. Accountability stays with the current owner
 * until the addressee accepts, so this never writes `assigned_to` directly.
 */
export async function assignWorkItem(input: z.infer<typeof assignmentSchema>): Promise<{ success: boolean; error?: string }> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid assignment' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('offer_work_item_transfer', {
    p_work_item_id: parsed.data.workItemId,
    p_to: parsed.data.assigneeId,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { success: false, error: 'This transfer could not be offered.' };

  await trackProductEvent({ eventName: 'work_item_reassigned', area: 'team' });
  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

const reassignmentSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
  assigneeId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Forced reassignment by a team manager. Recorded as `manager_reassigned`: moving work
 * is not the same as accepting it, so the previous acceptance is cleared by the database.
 */
export async function reassignWorkItem(
  input: z.infer<typeof reassignmentSchema>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = reassignmentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Document why this work is being reassigned.' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('reassign_work_item', {
    p_work_item_id: parsed.data.workItemId,
    p_to: parsed.data.assigneeId,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false, error: 'Work could not be reassigned.' };

  await trackProductEvent({ eventName: 'work_item_reassigned', area: 'team' });
  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

const workItemAcceptanceSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
});

/** The accountable provider takes the item. Acceptance is never inferred. */
export async function acceptWorkItem(
  input: z.infer<typeof workItemAcceptanceSchema>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = workItemAcceptanceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid work item' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('accept_work_item', {
    p_work_item_id: parsed.data.workItemId,
  });
  if (error) return { success: false, error: 'This item could not be accepted.' };

  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

/** Only the addressee of a pending transfer can accept it. */
export async function acceptTransfer(
  input: z.infer<typeof workItemAcceptanceSchema>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = workItemAcceptanceSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid work item' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('accept_work_item_transfer', {
    p_work_item_id: parsed.data.workItemId,
  });
  if (error) return { success: false, error: 'This transfer could not be accepted.' };

  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

const declineTransferSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
});

/** Declining returns the item to the previous accountable provider, with a reason on record. */
export async function declineTransfer(
  input: z.infer<typeof declineTransferSchema>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = declineTransferSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Declining a transfer requires a reason.' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('decline_work_item_transfer', {
    p_work_item_id: parsed.data.workItemId,
    p_reason: parsed.data.reason,
  });
  if (error) return { success: false, error: 'This transfer could not be declined.' };

  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

const designationSchema = z.object({
  organizationId: z.uuid(),
  patientId: z.uuid(),
  accountableId: z.uuid(),
  note: z.string().trim().min(3).max(500).optional(),
});

/**
 * Team manager designates the single accountable provider for a patient. New work for that
 * patient is assigned to the designated member; work already open is offered, never moved,
 * so `p_offer_open_items` stays false and delegation remains a per-item decision.
 */
export async function designatePatientAccountable(
  input: z.infer<typeof designationSchema>,
): Promise<{ success: boolean; error?: string }> {
  const parsed = designationSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'Invalid designation' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.rpc('designate_patient_accountable', {
    p_organization_id: parsed.data.organizationId,
    p_patient_id: parsed.data.patientId,
    p_accountable_id: parsed.data.accountableId,
    p_note: parsed.data.note ?? null,
    p_offer_open_items: false,
  });
  if (error) {
    return { success: false, error: 'The accountable provider could not be designated.' };
  }

  revalidateWorkSurfaces(parsed.data.patientId);
  return { success: true };
}

const savedViewSchema = z.object({
  name: z.string().trim().min(2).max(60),
  severity: z.enum(['critical', 'warning', 'informational']).optional(),
  priority: z.enum(['now', 'today', 'week', 'watching']).optional(),
  sourceType: z.enum([
    'alert', 'scheduled_followup', 'discharge_followup', 'manual', 'titration', 'data_quality',
  ]).optional(),
});

export async function saveQueueView(
  _state: { success?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const valueOrUndefined = (name: string) => {
    const value = String(formData.get(name) ?? '');
    return value || undefined;
  };
  const parsed = savedViewSchema.safeParse({
    name: formData.get('name'),
    severity: valueOrUndefined('severity'),
    priority: valueOrUndefined('priority'),
    sourceType: valueOrUndefined('sourceType'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid view' };
  if (!parsed.data.severity && !parsed.data.priority && !parsed.data.sourceType) {
    return { error: 'Choose at least one filter.' };
  }

  const auth = await authorize('provider');
  if (!auth.authorized) return { error: auth.error };
  const { error } = await auth.supabase.from('provider_saved_views').insert({
    provider_id: auth.user.id,
    name: parsed.data.name,
    severity: parsed.data.severity ?? null,
    priority: parsed.data.priority ?? null,
    source_type: parsed.data.sourceType ?? null,
  });
  if (error) return { error: 'This view could not be saved. Use a unique name.' };
  await trackProductEvent({ eventName: 'saved_view_created', area: 'provider_home' });
  revalidatePath('/dashboard');
  return { success: true };
}

export async function deleteQueueView(formData: FormData): Promise<void> {
  const viewId = z.uuid().safeParse(formData.get('viewId'));
  if (!viewId.success) return;
  const auth = await authorize('provider');
  if (!auth.authorized) return;
  await auth.supabase
    .from('provider_saved_views')
    .delete()
    .eq('id', viewId.data)
    .eq('provider_id', auth.user.id);
  revalidatePath('/dashboard');
}
