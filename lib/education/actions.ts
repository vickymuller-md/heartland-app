'use server';

/**
 * HEARTLAND Patient Education -- Server Actions
 *
 * Handles education module completion tracking.
 * Requirements: EDUC-05 (completion tracking)
 */

import { revalidatePath } from 'next/cache';
import { authorize } from '@/lib/auth/authorization';
import { EDUCATION_DOMAINS } from './constants';

export interface EducationActionState {
  success?: boolean;
  error?: string;
}

function isKnownDomain(domainId: string): boolean {
  return EDUCATION_DOMAINS.some((domain) => domain.id === domainId);
}

/**
 * Mark a module as completed after correct answer.
 * UPSERT into education_progress with completed=true and completed_at=now().
 */
export async function completeModule(
  prevState: EducationActionState | null,
  formData: FormData
): Promise<EducationActionState> {
  const domainId = formData.get('domain_id') as string;
  if (!isKnownDomain(domainId)) return { error: 'Invalid domain_id' };

  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };

  const { error } = await auth.supabase
    .from('education_progress')
    .upsert(
      {
        patient_id: auth.user.id,
        domain_id: domainId,
        completed: true,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'patient_id,domain_id' }
    );

  if (error) return { error: 'Failed to save progress' };

  revalidatePath('/education');
  return { success: true };
}

/**
 * Increment attempts counter for a domain.
 * Called on every answer submission (correct or incorrect).
 */
export async function incrementAttempts(
  domainId: string
): Promise<EducationActionState> {
  if (!isKnownDomain(domainId)) return { error: 'Invalid domain_id' };
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };

  // First try to get existing record
  const { data: existing } = await auth.supabase
    .from('education_progress')
    .select('attempts')
    .eq('patient_id', auth.user.id)
    .eq('domain_id', domainId)
    .single();

  const currentAttempts = existing?.attempts ?? 0;

  const { error } = await auth.supabase
    .from('education_progress')
    .upsert(
      {
        patient_id: auth.user.id,
        domain_id: domainId,
        attempts: currentAttempts + 1,
      },
      { onConflict: 'patient_id,domain_id' }
    );

  if (error) return { error: 'Failed to update attempts' };

  return { success: true };
}

/**
 * Reset a module for retaking education.
 * Sets completed=false, completed_at=null, attempts=0.
 */
export async function resetModule(
  domainId: string
): Promise<EducationActionState> {
  if (!isKnownDomain(domainId)) return { error: 'Invalid domain_id' };
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from('education_progress')
    .update({
      completed: false,
      completed_at: null,
      attempts: 0,
    })
    .eq('patient_id', auth.user.id)
    .eq('domain_id', domainId)
    .select('id');

  if (error || !data?.length) return { error: 'Failed to reset module' };

  revalidatePath('/education');
  return { success: true };
}
