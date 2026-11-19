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
  receipt?: string;
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

  const actor = formData.get('actorId');
  const requestId = formData.get('requestId');
  if (auth.user.id !== actor || !sendMessageSchema.shape.patientId.safeParse(requestId).success) {
    return { error: 'Session or draft changed. Reload this patient record.' };
  }
  const { data, error } = await auth.supabase.rpc('record_portal_message', {
    p_expected_actor: actor, p_patient_id: parsed.data.patientId, p_request_id: requestId,
    p_template: parsed.data.templateType, p_subject: parsed.data.subject, p_body: parsed.data.body,
  });
  if (error || data !== requestId) return { error: 'Portal save could not be confirmed. Retry this draft.' };
  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath('/alerts');
  revalidatePath('/today');
  return { success: true, receipt: String(requestId) };
}

export async function markMessageRead(messageId: string, patientId: string): Promise<{ success: boolean; error?: string }> {
  if (!sendMessageSchema.shape.patientId.safeParse(messageId).success) return { success: false, error: 'Invalid message ID' };
  const auth = await authorize('patient');
  if (!auth.authorized || auth.user.id !== patientId) return { success: false, error: 'Patient session changed. Reload this page.' };
  const { data, error } = await auth.supabase.rpc('confirm_portal_message_read', { p_expected_patient: patientId, p_message_id: messageId });
  if (error || typeof data !== 'string') return { success: false, error: 'Read confirmation unavailable. Try again.' };
  revalidatePath('/today');
  revalidatePath('/alerts');
  revalidatePath(`/patients/${patientId}`);
  return { success: true };
}
