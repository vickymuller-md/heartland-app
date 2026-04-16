'use server';

/**
 * HEARTLAND Patient Education -- Server Actions
 *
 * Handles education module completion tracking.
 * Requirements: EDUC-05 (completion tracking)
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface EducationActionState {
  success?: boolean;
  error?: string;
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
  if (!domainId) return { error: 'Missing domain_id' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('education_progress')
    .upsert(
      {
        patient_id: user.id,
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // First try to get existing record
  const { data: existing } = await supabase
    .from('education_progress')
    .select('attempts')
    .eq('patient_id', user.id)
    .eq('domain_id', domainId)
    .single();

  const currentAttempts = existing?.attempts ?? 0;

  const { error } = await supabase
    .from('education_progress')
    .upsert(
      {
        patient_id: user.id,
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('education_progress')
    .update({
      completed: false,
      completed_at: null,
      attempts: 0,
    })
    .eq('patient_id', user.id)
    .eq('domain_id', domainId);

  if (error) return { error: 'Failed to reset module' };

  revalidatePath('/education');
  return { success: true };
}
