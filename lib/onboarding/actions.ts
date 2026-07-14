'use server';

/**
 * Patient Onboarding Wizard -- Server Actions
 * Requirements: ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3
 */

import { authorizeProviderForPatient } from '@/lib/auth/authorization';
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
  if (![1, 2, 4, 8, 16].includes(stepBit)) return { error: 'Invalid setup step' };
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error };

  // Fetch current bitmask
  const { data: patient, error: fetchError } = await auth.supabase
    .from('patients')
    .select('setup_completed_steps')
    .eq('id', patientId)
    .single();

  if (fetchError || !patient) return { error: 'Unable to load setup progress' };

  const currentSteps = patient?.setup_completed_steps ?? 0;
  const newSteps = markStep(currentSteps, stepBit);

  // Update bitmask
  const { data, error: updateError } = await auth.supabase
    .from('patients')
    .update({ setup_completed_steps: newSteps })
    .eq('id', patientId)
    .select('id');

  if (updateError || !data?.length) return { error: 'Unable to update setup progress' };

  revalidatePath(`/patients/${patientId}/onboarding`);
  revalidatePath('/dashboard');

  return { success: true };
}
