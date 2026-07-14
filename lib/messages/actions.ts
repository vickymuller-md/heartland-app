'use server';

/**
 * HEARTLAND Provider Messages -- Server Actions
 *
 * sendMessage: Provider composes and sends a structured message to a patient.
 * markMessageRead: Patient marks a message as read (idempotent).
 *
 * Follows exact pattern of addProviderNote in lib/dashboard/actions.ts.
 *
 * Requirements: MSG-01, MSG-04
 */

import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';
import { revalidatePath } from 'next/cache';
import { sendMessageSchema } from './schema';

// ---------- Action State ----------

export interface MessageActionState {
  success?: boolean;
  errors?: Record<string, string[]>;
  error?: string;
}

// ---------- Send Message ----------

/**
 * Send a structured message from provider to patient.
 * Validates input with Zod, verifies auth, inserts via Supabase (RLS enforces link check).
 * Compatible with useActionState (prevState, formData) signature.
 */
export async function sendMessage(
  _prevState: unknown,
  formData: FormData
): Promise<MessageActionState> {
  // 1. Validate input
  const raw = {
    patientId: formData.get('patientId') as string,
    templateType: formData.get('templateType') as string,
    subject: formData.get('subject') as string,
    body: formData.get('body') as string,
  };

  const parsed = sendMessageSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      fieldErrors[key] = fieldErrors[key] ?? [];
      fieldErrors[key].push(issue.message);
    }
    return { errors: fieldErrors };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { error: auth.error };

  const { error } = await auth.supabase.from('provider_messages').insert({
    patient_id: parsed.data.patientId,
    provider_id: auth.user.id,
    template_type: parsed.data.templateType,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });

  if (error) return { error: 'Unable to send message' };

  // 4. Revalidate both provider detail page and patient today view
  revalidatePath(`/provider/patients/${parsed.data.patientId}`);
  revalidatePath('/today');
  return { success: true };
}

// ---------- Mark Message Read ----------

/**
 * Mark a message as read by the patient.
 * Idempotent: only updates if read_at IS NULL.
 * Called from patient-side message card on mount.
 */
export async function markMessageRead(
  messageId: string
): Promise<{ success: boolean; error?: string }> {
  if (!sendMessageSchema.shape.patientId.safeParse(messageId).success) {
    return { success: false, error: 'Invalid message ID' };
  }
  const auth = await authorize('patient');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('provider_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('patient_id', auth.user.id)
    .is('read_at', null)
    .select('id');

  if (error) return { success: false, error: 'Unable to update message' };
  if (!data?.length) return { success: true };

  revalidatePath('/today');
  return { success: true };
}
