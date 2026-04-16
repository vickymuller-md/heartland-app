'use server';

/**
 * Patient Onboarding Wizard -- Server Actions
 * Requirements: ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { markStep } from './constants';

/**
 * Mark a setup step as complete for a patient.
 * Reads the current bitmask, applies the step bit, writes back.
 * Revalidates onboarding and dashboard paths.
 */
export async function markSetupStep(
  patientId: string,
  stepBit: number
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  // Fetch current bitmask
  const { data: patient, error: fetchError } = await supabase
    .from('patients')
    .select('setup_completed_steps')
    .eq('id', patientId)
    .single();

  if (fetchError) return { error: fetchError.message };

  const currentSteps = patient?.setup_completed_steps ?? 0;
  const newSteps = markStep(currentSteps, stepBit);

  // Update bitmask
  const { error: updateError } = await supabase
    .from('patients')
    .update({ setup_completed_steps: newSteps })
    .eq('id', patientId);

  if (updateError) return { error: updateError.message };

  revalidatePath(`/patients/${patientId}/onboarding`);
  revalidatePath('/dashboard');

  return { success: true };
}
