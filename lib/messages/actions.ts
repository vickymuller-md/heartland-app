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

import { createClient } from '@/lib/supabase/server';
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

  // 2. Verify authentication
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  // 3. Insert message (RLS enforces linked-patient check)
  const { error } = await supabase.from('provider_messages').insert({
    patient_id: parsed.data.patientId,
    provider_id: user.id,
    template_type: parsed.data.templateType,
    subject: parsed.data.subject,
    body: parsed.data.body,
  });

  if (error) return { error: error.message };

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('provider_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('id', messageId)
    .is('read_at', null); // idempotent: only update if not yet read

  if (error) return { success: false, error: error.message };

  revalidatePath('/today');
  return { success: true };
}
