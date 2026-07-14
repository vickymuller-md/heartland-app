'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';
import { trackProductEvent } from '@/lib/product-analytics/actions';

const transitionSchema = z.object({
  workItemId: z.uuid(),
  patientId: z.uuid(),
  status: z.enum(['reviewed', 'actioned', 'awaiting', 'closed']),
  outcome: z.string().trim().min(3).max(1000).optional(),
  snoozeReason: z.string().trim().min(3).max(500).optional(),
  dueAt: z.iso.datetime().optional(),
}).superRefine((value, context) => {
  if (value.status === 'closed' && !value.outcome) {
    context.addIssue({ code: 'custom', path: ['outcome'], message: 'Outcome is required' });
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

  const update: Record<string, string | null> = { status: parsed.data.status };
  if (parsed.data.status === 'closed') update.outcome = parsed.data.outcome ?? null;
  if (parsed.data.status === 'awaiting') {
    update.snooze_reason = parsed.data.snoozeReason ?? null;
    update.due_at = parsed.data.dueAt ?? null;
  }

  const { data, error } = await auth.supabase
    .from('work_items')
    .update(update)
    .eq('id', parsed.data.workItemId)
    .eq('patient_id', parsed.data.patientId)
    .eq('provider_id', auth.user.id)
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
